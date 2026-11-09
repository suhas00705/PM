// Zoho CRM → Supabase sync for OB (Sales Orders) and Invoice line items.
//
// Writes into public.sales_lines with the same columns as the
// "Last & current FY year OB data" Excel (OB + Invoice sheets).
//
// Rules
//  * History up to 28-Sep-2026 came from the Excel (source = 'excel') and is never touched here.
//  * Zoho is the source for every Sales Order / Invoice CREATED on or after ZOHO_CUTOFF.
//  * Each Zoho line item is stored once, keyed by its Zoho line id (line_key = 'ZH-<id>'),
//    so re-running a sync never duplicates anything — it just refreshes values.
//  * Foreign-currency documents (export orders in USD etc.) are converted to INR with Zoho's Exchange_Rate.
//  * Lines removed from a document in Zoho, and documents that become Rejected / Cancelled,
//    are deleted from Supabase on the next sync.
//
// Env vars (Vercel → Settings → Environment Variables)
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN   (already set)
//   ZOHO_API_DOMAIN            optional, default https://www.zohoapis.com
//   SUPABASE_SERVICE_ROLE_KEY  optional — falls back to the portal's public key
//   SUPABASE_URL               optional, defaults to the PM portal project

const { getZohoAccessToken } = require('./zohoAuth');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xfdfbrfudsaxqgpsdboa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGZicmZ1ZHNheHFncHNkYm9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTA1MzgsImV4cCI6MjA5NzM2NjUzOH0.sfUC5Mn_d7-FGkvQHyD01kdGM81TjG4VWzXoFv43n94';
const ZOHO_CUTOFF = '2026-09-29T00:00:00+05:30';   // first day NOT covered by the Excel history
const PAGE = Number(process.env.SALES_SYNC_PAGE) || 2000;                             // COQL maximum rows per call
const WINDOW_DAYS = 3;                            // full mode walks Created_Time in 3-day windows
const SYNC_VERSION = '2026-11-09c gapfill+pending';        // shown in the sync response, to confirm the deployed code

const OB_FIELDS = [
  'Parent_Id', 'Parent_Id.SBU', 'Parent_Id.SAP_OA_No', 'Parent_Id.OA_Date', 'Parent_Id.Created_Time',
  'Parent_Id.Account_Name', 'Parent_Id.Account_Name.Account_Type', 'Parent_Id.PO_No', 'Parent_Id.SAP_BP_Code',
  'Parent_Id.Status', 'Parent_Id.Grand_Total', 'Parent_Id.Parcel_Charges', 'Parent_Id.Region', 'Parent_Id.Owner',
  'Parent_Id.Billing_City', 'Parent_Id.Billing_State', 'Parent_Id.Subject', 'Parent_Id.Currency', 'Parent_Id.Exchange_Rate',
  'Category_1', 'Product_Name', 'Product_Name.Product_Code', 'Product_Name.Cat_Code', 'Product_Name.SAP_Model_ID',
  'Product_Name.Model_Name', 'Product_Name.Product_Type', 'Product_Name.Product_Basket', 'Product_Name.Product_Series',
  'Product_Name.Category', 'Quantity', 'List_Price', 'Discount', 'Total', 'Total_After_Discount', 'Tax', 'Net_Total'
];
const INV_FIELDS = [
  'Parent_Id', 'Parent_Id.Company', 'Parent_Id.SAP_Invoice_Number', 'Parent_Id.Invoice_Date', 'Parent_Id.Created_Time',
  'Parent_Id.Account_Name', 'Parent_Id.Account_Name.Account_Type', 'Parent_Id.OA_Number', 'Parent_Id.PO_Number',
  'Parent_Id.Status', 'Parent_Id.Grand_Total', 'Parent_Id.Parcel_Charges', 'Parent_Id.Region', 'Parent_Id.Owner',
  'Parent_Id.Billing_City', 'Parent_Id.Billing_State', 'Parent_Id.Subject', 'Parent_Id.Currency', 'Parent_Id.Exchange_Rate',
  'Product_Name', 'Product_Name.Product_Code', 'Product_Name.Cat_Code', 'Product_Name.SAP_Model_ID',
  'Product_Name.Model_Name', 'Product_Name.Product_Type', 'Product_Name.Product_Basket', 'Product_Name.Product_Series',
  'Product_Name.Series_Name', 'Product_Name.Category', 'Product_Name.Group_Name',
  'Quantity', 'List_Price', 'Discount', 'Total', 'Total_After_Discount', 'Tax', 'Net_Total', 'Description'
];

// Never counted (user rule): B & E Electric orders and SAP test orders
const EXCLUDE_ACCOUNTS = /B\s*&\s*E\s+ELECTRIC|TEST\s+DUMMY/i;
// One-time backfill: Zoho-approved FY 2026-27 OAs created BEFORE ZOHO_CUTOFF that are missing from the SAP Excel
const OB_BACKFILL_OAS = require('./obBackfill');

const CFG = {
  // OB: only sales orders with status exactly "Approved" count (Created, Approved for Payment, PI Request,
  // Payment Commitment, Approval for Sales Commission … are left out until they become Approved; Rejected/Cancelled never count)
  OB:  { module: 'Ordered_Items',  fields: OB_FIELDS,  skipStatus: /reject|cancel/i, onlyStatus: /^approved$/i },
  INV: { module: 'Invoiced_Items', fields: INV_FIELDS, skipStatus: /cancel|void/i }
};

// DocNum series → company code, learned from the Excel (digits 3-5 of the SAP number)
const OB_SERIES  = { '116': 'ELM', '176': 'AHM', '177': 'AHM', '276': 'Coimbatore_Live', '270': 'Adiga' };
const INV_SERIES = { '110': 'ELM', '111': 'ELM', '175': 'AHD', '275': 'Coimbatore_Live', '270': 'Adiga' };

// ---------------------------------------------------------------- helpers
const nm  = v => (v && typeof v === 'object') ? (v.name ?? null) : (v ?? null);
const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const int = v => { const n = num(v); return n === null ? null : Math.trunc(n); };
const day = v => (typeof v === 'string' && v.length >= 10) ? v.slice(0, 10) : null;
const str = v => (v === null || v === undefined || v === '') ? null : String(v);

function companyFor(docNum, series, fallbackName) {
  const s = String(docNum || '');
  if (s.length >= 5 && series[s.slice(2, 5)]) return series[s.slice(2, 5)];
  const f = String(fallbackName || '').toUpperCase();
  if (f.includes('AHD')) return series === OB_SERIES ? 'AHM' : 'AHD';
  if (f.includes('ADIGA')) return 'Adiga';
  if (f.includes('CBE') || f.includes('UNIT -1') || f.includes('COIMBATORE')) return 'Coimbatore_Live';
  return 'ELM';
}

function priceDisc(r) {
  const q = num(r.Quantity) || 0, tot = num(r.Total) || 0, tad = num(r.Total_After_Discount) || 0;
  return {
    price: q ? Math.round((tad / q) * 10000) / 10000 : null,
    disc:  tot ? Math.round(((num(r.Discount) || 0) / tot) * 100000) / 1000 : 0
  };
}

function istStamp(date) {
  const ist = new Date(date.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 19) + '+05:30';
}

// ---------------------------------------------------------------- Zoho
async function coql(token, query) {
  const api = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${api}/crm/v8/coql`, {
      method: 'POST',
      headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ select_query: query })
    });
    if (res.status === 204) return { data: [], more: false };
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { data: body.data || [], more: !!body.info?.more_records };
    if (attempt === 3 || (res.status < 500 && res.status !== 429)) {
      throw new Error(`Zoho COQL ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
    }
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }
}

async function zohoUsers(token) {
  const api = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
  const map = {};
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${api}/crm/v8/users?type=AllUsers&per_page=200&page=${page}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    if (!res.ok) break;
    const body = await res.json();
    (body.users || []).forEach(u => { map[u.id] = u.full_name; });
    if (!body.info?.more_records) break;
  }
  return map;
}

// ---------------------------------------------------------------- mapping
function mapLine(type, r, users, runStamp) {
  const P = k => r[`Parent_Id.${k}`];
  const owner = P('Owner');
  const slp = owner ? (users[owner.id] || owner.name || null) : null;
  const { price, disc } = priceDisc(r);
  const created = day(P('Created_Time'));
  // Export orders are kept in Zoho in their own currency (e.g. USD). Convert every value to INR with the
  // document's Zoho exchange rate (Exchange_Rate = foreign units per 1 INR, e.g. 0.010798 USD -> x 92.61).
  const cur = str(P('Currency')), xr = num(P('Exchange_Rate'));
  const fx = (cur && cur.toUpperCase() !== 'INR' && xr > 0) ? 1 / xr : 1;
  const inr = v => (v === null || v === undefined) ? v : Math.round(v * fx * 100) / 100;
  const common = {
    line_key: `ZH-${r.id}`,
    doc_type: type,
    source: 'zoho',
    zoho_parent_id: r.Parent_Id?.id ? String(r.Parent_Id.id) : null,
    row_no: null,
    card_name: nm(P('Account_Name')),
    account_type: str(P('Account_Name.Account_Type')),
    item_code: str(r['Product_Name.SAP_Model_ID']),
    cat_code: str(r['Product_Name.Cat_Code'] || r['Product_Name.Product_Code']),
    product_type: str(r['Product_Name.Product_Type']),
    description: nm(r.Product_Name),
    model_id: str(r['Product_Name.Model_Name']),
    product_basket: str(r['Product_Name.Product_Basket']),
    product_series: str(r['Product_Name.Product_Series']),
    quantity: num(r.Quantity),
    price: inr(price),
    disc_prcnt: disc,
    list_price: inr(num(r.List_Price)),
    doc_total: inr(num(P('Grand_Total'))),
    line_total: inr(num(r.Total_After_Discount)),
    tax_calc: inr(num(r.Tax)),
    freight_charges: inr(num(P('Parcel_Charges')) || 0),
    doc_total_fc: inr(num(r.Net_Total)),
    region: str(P('Region')),
    slp_name: slp,
    se_reg: str(P('Region')),
    billing_city: str(P('Billing_City')),
    billing_state: str(P('Billing_State')),
    crm_subject: str(P('Subject')),
    crm_status: str(P('Status')),
    synced_at: runStamp
  };
  if (type === 'OB') {
    const dn = int(P('SAP_OA_No'));
    const date = day(P('OA_Date')) || created;
    return {
      ...common,
      company: companyFor(dn, OB_SERIES, nm(P('SBU'))),
      doc_num: dn, posting_date: date, doc_date: date,
      u_internal: /INTERNAL/i.test(P('Subject') || '') ? 'Y' : null,
      num_at_card: str(P('PO_No')),
      card_code: str(P('SAP_BP_Code')),
      product_category: str(r.Category_1 || r['Product_Name.Category']),
      extra_description: null, items_grp_nam: null, series_name: null, oa_no: null
    };
  }
  const dn = int(P('SAP_Invoice_Number'));
  const date = day(P('Invoice_Date')) || created;
  return {
    ...common,
    company: companyFor(dn, INV_SERIES, nm(P('Company'))),
    doc_num: dn, posting_date: date, doc_date: date,
    u_internal: null,
    num_at_card: str(P('PO_Number')),
    card_code: null,
    product_category: str(r['Product_Name.Category']),
    extra_description: str(r.Description),
    items_grp_nam: str(r['Product_Name.Group_Name']),
    series_name: str(r['Product_Name.Series_Name']),
    oa_no: str(P('OA_Number'))
  };
}

// ---------------------------------------------------------------- Supabase
function sbHeaders(extra = {}) {
  // Uses the service_role key if one is set in Vercel, otherwise the same public key the rest of the portal uses.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

async function sb(path, opts = {}, okEmpty = true) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: sbHeaders(opts.headers) });
    if (res.ok) {
      const t = await res.text();
      return t ? JSON.parse(t) : (okEmpty ? null : []);
    }
    const t = await res.text();
    if (attempt === 3 || res.status < 500) throw new Error(`Supabase ${res.status} on ${path.split('?')[0]}: ${t.slice(0, 400)}`);
    await new Promise(r => setTimeout(r, 1000 * attempt));
  }
}

async function excelDocNums(type, docNums) {
  const found = new Set();
  const list = [...new Set(docNums.filter(Boolean))];
  for (let i = 0; i < list.length; i += 150) {
    const chunk = list.slice(i, i + 150).join(',');
    const rows = await sb(`sales_lines?select=doc_num&source=eq.excel&doc_type=eq.${type}&doc_num=in.(${chunk})`, { method: 'GET' });
    (rows || []).forEach(r => found.add(Number(r.doc_num)));
  }
  return found;
}

async function upsert(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await sb('sales_lines?on_conflict=line_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500))
    });
  }
  return rows.length;
}

// delete Zoho lines of the given parents that were not refreshed in this run
async function deleteStale(parentIds, runStamp) {
  let deleted = 0;
  const ids = [...parentIds];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = encodeURIComponent(ids.slice(i, i + 100).map(x => `"${x}"`).join(','));
    const rows = await sb(`sales_lines?source=eq.zoho&zoho_parent_id=in.(${chunk})&synced_at=lt.${encodeURIComponent(runStamp)}`,
      { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    deleted += (rows || []).length;
  }
  return deleted;
}

async function writeLog(entry) {
  try {
    await sb('sales_sync_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(entry) });
  } catch (e) { /* logging must never break the sync */ }
}

// ---------------------------------------------------------------- main
/**
 * runSync({ type: 'OB'|'INV', mode: 'daily'|'full', days, from, offset, run })
 *   daily : documents (created ≥ cutoff) MODIFIED in the last `days` days (default 3)
 *   full  : every document created ≥ cutoff (or ≥ `from`), walked in 3-day windows; resumable
 */
async function runSync({ type, mode = 'daily', days = 3, from = null, offset = 0, run = null }) {
  const cfg = CFG[type];
  const started = new Date();
  const deadline = Date.now() + 50000;
  const runStamp = run || started.toISOString();
  const stats = { fetched: 0, upserted: 0, deleted: 0, skipped: 0 };
  let hasMore = false, resume = null;

  try {
    const token = await getZohoAccessToken();
    const users = await zohoUsers(token);
    const select = `select ${cfg.fields.join(', ')} from ${cfg.module}`;

    // Build the list of Created_Time windows to walk
    const windows = [];
    if (mode === 'backfill') {
      for (let i = 0; i < OB_BACKFILL_OAS.length; i += 100) windows.push({ oas: OB_BACKFILL_OAS.slice(i, i + 100) });
    } else if (mode === 'full') {
      let s = new Date(from ? `${from}T00:00:00+05:30` : ZOHO_CUTOFF);
      const end = new Date(Date.now() + 86400000);
      while (s < end) { const e = new Date(s.getTime() + WINDOW_DAYS * 86400000); windows.push([s, e]); s = e; }
    } else {
      windows.push(null);
    }

    outer:
    for (let w = 0; w < windows.length; w++) {
      let where;
      if (windows[w] && windows[w].oas) {
        where = `Parent_Id.SAP_OA_No in (${windows[w].oas.map(x => `'${x}'`).join(',')})`;
      } else if (windows[w]) {
        const [s, e] = windows[w];
        const lo = s < new Date(ZOHO_CUTOFF) ? ZOHO_CUTOFF : istStamp(s);
        where = `Parent_Id.Created_Time >= '${lo}' and Parent_Id.Created_Time < '${istStamp(e)}'`;
      } else {
        const since = istStamp(new Date(Date.now() - days * 86400000));
        where = `Parent_Id.Created_Time >= '${ZOHO_CUTOFF}' and Parent_Id.Modified_Time >= '${since}'`;
      }

      let off = (w === 0) ? offset : 0;
      const parents = new Set();
      while (true) {
        if (Date.now() > deadline - 8000) {
          hasMore = true;
          resume = { mode, days, from: (windows[w] && !windows[w].oas) ? istStamp(windows[w][0]).slice(0, 10) : null, offset: off, run: runStamp };
          break outer;
        }
        const { data, more } = await coql(token, `${select} where ${where} order by id asc limit ${off}, ${PAGE}`);
        stats.fetched += data.length;

        const keep = [];
        for (const r of data) {
          if (r.Parent_Id?.id) parents.add(String(r.Parent_Id.id));
          const st = String(r['Parent_Id.Status'] || '').trim();
          if (cfg.skipStatus.test(st) || (cfg.onlyStatus && !cfg.onlyStatus.test(st))) { stats.skipped++; continue; }
          if (type === 'OB' && EXCLUDE_ACCOUNTS.test(String(nm(r['Parent_Id.Account_Name']) || ''))) { stats.skipped++; continue; }
          keep.push(mapLine(type, r, users, runStamp));
        }
        // never double-count a document that already exists in the Excel history
        const dupes = await excelDocNums(type, keep.map(x => x.doc_num));
        const rows = keep.filter(x => !(x.doc_num && dupes.has(x.doc_num)));
        stats.skipped += keep.length - rows.length;
        stats.upserted += await upsert(rows);

        if (!more || data.length < PAGE) break;
        off += PAGE;
      }
      // all lines of these documents are refreshed → drop lines that vanished / became rejected
      stats.deleted += await deleteStale(parents, runStamp);
    }

    await writeLog({ doc_type: type, mode, started_at: started.toISOString(), finished_at: new Date().toISOString(),
                     ...stats, has_more: hasMore, status: 'ok', message: hasMore ? 'partial – resume needed' : null });
    return { ok: true, type, mode, ...stats, hasMore, resume, syncedAt: new Date().toISOString() };
  } catch (err) {
    await writeLog({ doc_type: type, mode, started_at: started.toISOString(), finished_at: new Date().toISOString(),
                     ...stats, has_more: hasMore, status: 'error', message: String(err.message || err).slice(0, 1000) });
    return { ok: false, type, mode, ...stats, error: String(err.message || err) };
  }
}

// ---------------------------------------------------------------- invoice gap-fill (09-Nov-2026)
// The SAP Excel history (invoices up to 28-Sep-2026) did not include some invoices that ARE in Zoho –
// mainly the service-invoice series 261103xxx (₹446 L in FY 2026-27) – so portal invoicing was lower than the
// Zoho "YTD Invoice". This walks Zoho invoices by Invoice_Date, finds the ones whose SAP invoice number is not
// in sales_lines at all, and adds their line items (source 'zoho', line_key ZH-<id>, so re-running never
// duplicates). Invoices already in the Excel history are never touched. &dry=1 only reports.
//   /api/sync-invoice?mode=gapfill&from=2025-04-01&to=2026-09-28[&dry=1]   (resumable via resumeWith)
const GAP_WINDOW_DAYS = 7;
async function existingInvDocNums(docNums) {
  const found = new Set();
  const list = [...new Set(docNums.filter(Boolean))];
  for (let i = 0; i < list.length; i += 150) {
    const rows = await sb(`sales_lines?select=doc_num&doc_type=eq.INV&doc_num=in.(${list.slice(i, i + 150).join(',')})`, { method: 'GET' });
    (rows || []).forEach(r => found.add(Number(r.doc_num)));
  }
  return found;
}
async function runGapfill({ from, to, run = null, dry = false }) {
  const started = new Date();
  const deadline = Date.now() + 50000;
  const runStamp = run || started.toISOString();
  const stats = { invoices: 0, missing: 0, fetched: 0, upserted: 0, value: 0, bySeries: {} };
  const end = to || '2026-09-28';
  let hasMore = false, resume = null;
  try {
    const token = await getZohoAccessToken();
    const users = dry ? {} : await zohoUsers(token);
    let s = new Date(`${from || '2026-04-01'}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (s <= last) {
      if (Date.now() > deadline - 10000) { hasMore = true; resume = { from: s.toISOString().slice(0, 10), to: end, run: runStamp, dry }; break; }
      const e = new Date(Math.min(s.getTime() + (GAP_WINDOW_DAYS - 1) * 86400000, last.getTime()));
      const a = s.toISOString().slice(0, 10), b = e.toISOString().slice(0, 10);
      // 1) invoice headers of the window
      const heads = [];
      for (let off = 0; ; off += PAGE) {
        const { data, more } = await coql(token, `select id, SAP_Invoice_Number, Status from Invoices where Invoice_Date between '${a}' and '${b}' order by id asc limit ${off}, ${PAGE}`);
        heads.push(...data);
        if (!more || data.length < PAGE) break;
      }
      const live = heads.filter(h => !CFG.INV.skipStatus.test(String(h.Status || '')) && int(h.SAP_Invoice_Number));
      stats.invoices += live.length;
      // 2) which of them are not in the portal at all
      const have = await existingInvDocNums(live.map(h => int(h.SAP_Invoice_Number)));
      const miss = live.filter(h => !have.has(int(h.SAP_Invoice_Number)));
      stats.missing += miss.length;
      // 3) their line items
      for (let i = 0; i < miss.length; i += 50) {
        const ids = miss.slice(i, i + 50).map(h => `'${h.id}'`).join(',');
        for (let off = 0; ; off += PAGE) {
          const { data, more } = await coql(token, `select ${INV_FIELDS.join(', ')} from Invoiced_Items where Parent_Id in (${ids}) order by id asc limit ${off}, ${PAGE}`);
          stats.fetched += data.length;
          const rows = data.map(r => mapLine('INV', r, users, runStamp)).filter(x => x.doc_num);
          rows.forEach(x => { const k = String(x.doc_num).slice(0, 6); stats.value += x.doc_total_fc || 0; stats.bySeries[k] = (stats.bySeries[k] || 0) + (x.doc_total_fc || 0); });
          if (!dry) stats.upserted += await upsert(rows);
          if (!more || data.length < PAGE) break;
        }
      }
      s = new Date(e.getTime() + 86400000);
    }
    stats.value = Math.round(stats.value / 1000) / 100;                      // ₹ lakhs
    Object.keys(stats.bySeries).forEach(k => stats.bySeries[k] = Math.round(stats.bySeries[k] / 1000) / 100);
    if (!dry) await writeLog({ doc_type: 'INV', mode: 'gapfill', started_at: started.toISOString(), finished_at: new Date().toISOString(),
                               fetched: stats.fetched, upserted: stats.upserted, deleted: 0, skipped: 0, has_more: hasMore, status: 'ok',
                               message: `gapfill ${from}..${end} missing ${stats.missing} value ₹${stats.value} L` });
    return { ok: true, type: 'INV', mode: 'gapfill', dry, from, to: end, ...stats, valueUnit: '₹ lakhs', hasMore, resume, syncedAt: new Date().toISOString() };
  } catch (err) {
    return { ok: false, type: 'INV', mode: 'gapfill', ...stats, error: String(err.message || err) };
  }
}

// ---------------------------------------------------------------- pending to bill (09-Nov-2026)
// Copies Zoho "Pending Orders" (approved orders not yet invoiced – balance qty and balance amount with tax,
// the source of Zoho's "Pending Orders – Not Yet Billed") into pending_orders. Zoho rebuilds that module every
// evening, so each run writes a complete new copy and only then makes it the live one (pending_snap). A copy that
// looks incomplete (fewer than 70% of the rows of the live copy, e.g. read while Zoho is rebuilding) is thrown
// away and the live copy stays. /api/sync-invoice?mode=pending   (cron-2h runs it at 21:00 IST, catch-up 23:00; frozen till next 9 pm)
const PEND_FIELDS = ['Sales_Order_No1', 'OA_Date', 'Item_No', 'Model_No', 'Sub_Model_Description', 'Balance_Qty',
  'Bal_Amount_with_Tax', 'Region', 'Account_Name', 'Sales_Employee_Name', 'Pdn_Del_Date', 'Order_Approval',
  'Modified_Time', 'Created_Time', 'Currency', 'Exchange_Rate'];
// Zoho rebuilds Pending Orders once a day: it DELETES the old rows during the afternoon and CREATES the new set in the
// evening (seen 8/9-Nov-2026: created 19:20–20:25 IST, deleted from ~15:00 IST next day). Rows never change in between.
// So a copy is taken only when Zoho holds a NEW, FINISHED build: its newest Created_Time is later than the live copy's
// and at least 15 minutes old. While old rows are being deleted (same build, fewer rows) the live copy is kept.
const PEND_SETTLE_MS = 15 * 60 * 1000;
async function runPending({ force = false } = {}) {
  const started = new Date();
  const snap = started.toISOString();
  try {
    const token = await getZohoAccessToken();
    const rows = []; let maxCreated = null;
    for (let off = 0; ; off += PAGE) {
      const { data, more } = await coql(token, `select ${PEND_FIELDS.join(', ')} from Pending_Orders where Created_Time >= '2000-01-01T00:00:00+05:30' order by id asc limit ${off}, ${PAGE}`);
      data.forEach(r => {
        const cur = str(r.Currency), xr = num(r.Exchange_Rate);
        const fx = (cur && cur.toUpperCase() !== 'INR' && xr > 0) ? 1 / xr : 1;
        const ct = str(r.Created_Time); if (ct && (!maxCreated || new Date(ct) > new Date(maxCreated))) maxCreated = ct;
        rows.push({
          id: String(r.id), snap_at: snap,
          oa_no: str(r.Sales_Order_No1), oa_date: day(r.OA_Date), item_no: str(r.Item_No), model_no: str(r.Model_No),
          descr: str(r.Sub_Model_Description), bal_qty: num(r.Balance_Qty),
          bal_amt: num(r.Bal_Amount_with_Tax) === null ? null : Math.round(num(r.Bal_Amount_with_Tax) * fx * 100) / 100,
          region: str(r.Region), account: nm(r.Account_Name), account_id: r.Account_Name?.id ? String(r.Account_Name.id) : null,
          sales_emp: str(r.Sales_Employee_Name), pdn_del_date: day(r.Pdn_Del_Date),
          so_id: r.Order_Approval?.id ? String(r.Order_Approval.id) : null, so_name: nm(r.Order_Approval),
          zoho_modified: str(r.Modified_Time)
        });
      });
      if (!more || data.length < PAGE || off > 40000) break;
    }
    const total = Math.round(rows.reduce((s, r) => s + (r.bal_amt || 0), 0));
    const cur = await sb('pending_snap?id=eq.1&select=snap_at,rows,total,note', { method: 'GET' });
    const prev = cur && cur[0];
    // live copies saved before 09-Nov-2026c have no build stamp: their copy time is a safe upper bound
    const prevBuild = prev ? (/^build:/.test(prev.note || '') ? prev.note.slice(6) : prev.snap_at) : null;
    const base = { ok: true, mode: 'pending', fetched: rows.length, totalLakhs: Math.round(total / 1000) / 100, zohoBuild: maxCreated, liveBuild: prevBuild };
    if (!rows.length) return { ...base, note: 'Zoho returned no rows – live copy kept' };
    if (!force) {
      if (maxCreated && Date.now() - new Date(maxCreated).getTime() < PEND_SETTLE_MS)
        return { ...base, note: 'Zoho is still creating the new pending list – live copy kept' };
      if (prev && prevBuild && maxCreated && new Date(maxCreated) <= new Date(prevBuild))
        return { ...base, note: rows.length < prev.rows ? `Zoho is clearing yesterday's list (${rows.length} of ${prev.rows} rows left) – live copy kept`
                                                         : 'no new Zoho build – live copy kept' };
      if (prev && prev.rows > 300 && rows.length < prev.rows * 0.5)
        return { ...base, note: `only ${rows.length} rows vs ${prev.rows} – looks incomplete, live copy kept` };
    }
    for (let i = 0; i < rows.length; i += 500) {
      await sb('pending_orders?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                                                  body: JSON.stringify(rows.slice(i, i + 500)) });
    }
    // make this copy the live one – but never replace a NEWER copy (two runs at the same time, e.g. cron + browser)
    const meta = { snap_at: snap, rows: rows.length, total, synced_at: new Date().toISOString(), note: maxCreated ? 'build:' + maxCreated : null };
    if (!prev) await sb('pending_snap?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                                                        body: JSON.stringify([{ id: 1, ...meta }]) });
    else await sb(`pending_snap?id=eq.1&snap_at=lt.${encodeURIComponent(snap)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
                                                                                   body: JSON.stringify(meta) });
    // drop only copies OLDER than the live one (a newer run still writing keeps its rows)
    const live = await sb('pending_snap?id=eq.1&select=snap_at', { method: 'GET' });
    const liveAt = live && live[0] && live[0].snap_at;
    if (liveAt) await sb(`pending_orders?snap_at=lt.${encodeURIComponent(liveAt)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return { ...base, saved: rows.length, total, syncedAt: new Date().toISOString() };
  } catch (err) {
    return { ok: false, mode: 'pending', error: String(err.message || err) };
  }
}

// Shared Vercel handler: /api/sync-ob and /api/sync-invoice
function handlerFor(type) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const q = req.query || {};
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
    if (type === 'INV' && q.mode === 'pending') {
      const out = await runPending({ force: q.force === '1' }); out.version = SYNC_VERSION;
      return res.status(out.ok ? 200 : 500).json(out);
    }
    if (type === 'INV' && q.mode === 'gapfill') {
      const out = await runGapfill({ from: isDate(q.from) ? q.from : '2026-04-01', to: isDate(q.to) ? q.to : '2026-09-28',
                                     run: q.run || null, dry: q.dry === '1' });
      if (out.resume) { const r = out.resume; out.resumeWith = `?mode=gapfill&from=${r.from}&to=${r.to}${r.dry ? '&dry=1' : ''}&run=${encodeURIComponent(r.run)}`; }
      out.version = SYNC_VERSION;
      return res.status(out.ok ? 200 : 500).json(out);
    }
    const out = await runSync({
      type,
      mode: q.mode === 'full' ? 'full' : (q.mode === 'backfill' && type === 'OB') ? 'backfill' : 'daily',
      days: Math.min(Math.max(parseInt(q.days || '3', 10) || 3, 1), 60),
      from: /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : null,
      offset: parseInt(q.offset || '0', 10) || 0,
      run: q.run || null
    });
    if (out.resume) {
      const r = out.resume;
      out.resumeWith = `?mode=${r.mode}&days=${r.days}${r.from ? `&from=${r.from}` : ''}&offset=${r.offset}&run=${encodeURIComponent(r.run)}`;
    }
    out.version = SYNC_VERSION;
    res.status(out.ok ? 200 : 500).json(out);
  };
}

module.exports = { runSync, runGapfill, runPending, handlerFor, mapLine, companyFor };
