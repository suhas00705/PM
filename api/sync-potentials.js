const zohoAuth = require('../lib/zohoAuth');
const supabasePotentials = require('../lib/supabasePotentials');
// 17-Nov-2026: product lines of each potential (Zoho sub-table "Products - Information") for the Products tab.
const { sb } = require('../lib/appAuth');

const POTENTIALS_FIELDS = [
  'Deal_Name', 'Account_Name', 'Owner', 'Stage', 'Amount',
  'Product_Solution_Type_Multi_Select', 'Region',
  'Created_Time', 'Modified_Time', 'Closing_Date', 'Probability', 'Last_Activity_Time', 'Lead_Source', 'Project_Name'
].join(',');  // Project_Name: 30-Oct-2026 (Region Tracking 'won without OA' list)

// FY2025-26 starts April 1, 2025 (IST)
const FY_START = '2025-04-01T00:00:00+05:30';

// Zoho COQL (same call lib/salesSync.js uses). /search ignores both page_token and sort order,
// so a full scan through it silently skipped most records; COQL sorts properly (2,000 rows per call).
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
function ownerName(r) {
  return [r['Owner.first_name'], r['Owner.last_name']].filter(Boolean).join(' ') || null;
}
const istIso = ms => new Date(ms + 19800000).toISOString().substring(0, 19) + '+05:30';
function nextSecond(ts) {
  const t = new Date(new Date(ts).getTime() + 1000 + 19800000);
  return t.toISOString().substring(0, 19) + '+05:30';
}

// ─── ?mode=lines (17-Nov-2026, Products tab) ────────────────────────────────────────────────────────
// Copies the "Products - Information" sub-table of every potential (basket, series, model, qty, amount per
// product) into Supabase pot_lines, so a deal that names 2 baskets shows each basket's own value.
// It walks all lines by id, 2,000 per Zoho call, for ~40 s per run, and remembers where it stopped
// (pot_lines_state). When a full pass ends, lines not seen in that pass (deleted in Zoho) are removed.
// Called from /api/cron-2h every slot, so a full pass finishes every few hours. Writes need SUPABASE_SERVICE_KEY.
async function syncLines(accessToken, req) {
  const deadline = Date.now() + 40000;
  const st = (await sb('pot_lines_state?id=eq.1&select=*'))[0] || {};
  let cursor = req.query?.restart === '1' ? null : st.cursor_id || null;
  let sweepStart = cursor && st.sweep_start ? st.sweep_start : new Date().toISOString();
  const runAt = new Date().toISOString();
  let fetched = 0, saved = 0, done = false, removed = 0;
  while (Date.now() < deadline) {
    const where = cursor ? `id > ${cursor}` : 'id is not null';
    const q = `select id, Parent_Id, Product_Basket1, Product_Basket, Product_Series, Product_Name, Model_Name, Quantity, Amount, Modified_Time from Products_Information1 where ${where} order by id asc limit 2000`;
    const { data, more } = await coql(accessToken, q);
    fetched += data.length;
    const rows = data
      .filter(r => r.Parent_Id && r.Parent_Id.id && (r.Amount != null || r.Product_Basket1 || r.Product_Basket))
      .map(r => ({
        id: String(r.id), deal_id: String(r.Parent_Id.id),
        basket: r.Product_Basket1 || r.Product_Basket || null,
        series: r.Product_Series || r.Product_Name || null,
        model: r.Model_Name || null,
        qty: r.Quantity ?? null, amount: r.Amount ?? null,
        modified: r.Modified_Time || null, seen_at: runAt
      }));
    for (let i = 0; i < rows.length; i += 1000) {
      await sb('pot_lines', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                              body: JSON.stringify(rows.slice(i, i + 1000)) });
    }
    saved += rows.length;
    if (data.length) cursor = String(data[data.length - 1].id);
    if (!more || data.length < 2000) { done = true; break; }
  }
  if (done) {
    // lines not seen since this pass started were deleted in Zoho
    const del = await sb(`pot_lines?seen_at=lt.${encodeURIComponent(sweepStart)}&select=id`,
                         { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    removed = Array.isArray(del) ? del.length : 0;   // only ids come back, and only for deleted lines
  }
  await sb('pot_lines_state?id=eq.1', { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ cursor_id: done ? null : cursor, sweep_start: done ? null : sweepStart,
                           last_run: runAt, ...(done ? { last_done: runAt } : {}),
                           note: `fetched ${fetched}, saved ${saved}${done ? `, pass done, removed ${removed}` : ''}` }) });
  return { ok: true, mode: 'lines', fetched, saved, done, removed, hasMore: !done };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
    const accessToken = await zohoAuth.getZohoAccessToken();
    const authHeader = { Authorization: `Zoho-oauthtoken ${accessToken}` };
    if (req.query?.mode === 'lines') return res.status(200).json(await syncLines(accessToken, req));

    // ─── MODE SELECTION ───────────────────────────────────────────────────────
    // ?mode=full   → Full FY scan sorted by Created_Time ASC (no time cutoff).
    //                Catches ALL records including old ones with changed stages.
    //                Supports ?since_created=ISO_DATE to resume from a point.
    //
    // ?mode=incremental (default)
    //             → Sort by Modified_Time DESC, stop at window cutoff (default 48h).
    //                Quickly catches stage changes on any recently-touched record.
    //                Used for daily syncs.
    // ─────────────────────────────────────────────────────────────────────────

    const mode = req.query?.mode || 'incremental';
    const PER_PAGE = 200;
    const deadline = Date.now() + 55000; // 55s budget

    let records = [];
    let page = 1;
    let pageToken = null;
    let more = true;
    let lastCreatedAt = null; // returned in full mode so caller can resume
    let activityExtra = 0, activityError;

    if (mode === 'full') {
      // ── FULL FY SCAN ──────────────────────────────────────────────────────
      // Fetches records by Created_Time ASC from FY_START (or since_created).
      // Paginate until we exhaust records or hit the deadline.
      // The caller can pass ?since_created=ISO to resume after a partial run.
      // COQL, ordered by Created_Time, walking forward with a cursor (2,000 rows per call).
      // default starts far back: old deals still count if their closing date is in this FY or later
      let cursor = req.query?.since_created || '2010-01-01T00:00:00+05:30';
      const seen = new Set();
      more = true;
      while (Date.now() < deadline) {
        const q = `select id, Deal_Name, Account_Name.Account_Name, Owner.first_name, Owner.last_name, Stage, Amount, Probability, Region, Closing_Date, Created_Time, Modified_Time, Last_Activity_Time, Lead_Source, Project_Name, Product_Solution_Type_Multi_Select from Deals where (Created_Time >= '${FY_START}' or Closing_Date >= '${FY_START.substring(0, 10)}') and Created_Time >= '${cursor}' order by Created_Time asc limit 2000`;
        const { data, more: zMore } = await coql(accessToken, q);
        const fresh = data.filter(rec => !seen.has(rec.id));
        fresh.forEach(rec => seen.add(rec.id));
        records = records.concat(fresh.map(r => ({ id: r.id, Deal_Name: r.Deal_Name, Account_Name: { name: r['Account_Name.Account_Name'] || null }, Owner: { name: ownerName(r) }, Stage: r.Stage, Amount: r.Amount, Probability: r.Probability, Region: r.Region, Closing_Date: r.Closing_Date, Created_Time: r.Created_Time, Modified_Time: r.Modified_Time, Last_Activity_Time: r.Last_Activity_Time, Lead_Source: r.Lead_Source, Project_Name: r.Project_Name, Product_Solution_Type_Multi_Select: r.Product_Solution_Type_Multi_Select || [] })));
        if (data.length) lastCreatedAt = data[data.length - 1].Created_Time;
        if (!zMore || data.length < 2000) { more = false; break; }
        cursor = (!fresh.length || lastCreatedAt === cursor) ? nextSecond(cursor) : lastCreatedAt;
      }

    } else {
      // ── INCREMENTAL MODE (default) ────────────────────────────────────────
      // Sort by Modified_Time DESC, stop when we hit records older than the window.
      // Catches ANY record whose stage (or any field) changed recently.
      const windowHours = parseInt(req.query?.window || '48', 10);
      const cutoffTime = Date.now() - windowHours * 60 * 60 * 1000;

      while (more && Date.now() < deadline) {
        let url = `${ZOHO_API_DOMAIN}/crm/v8/Deals?fields=${POTENTIALS_FIELDS}&per_page=${PER_PAGE}&sort_by=Modified_Time&sort_order=desc`;
        url += pageToken ? `&page_token=${pageToken}` : `&page=${page}`;

        const r = await fetch(url, { headers: authHeader });
        if (r.status === 204) break;
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`Zoho fetch failed: ${r.status} ${t}`);
        }
        const data = await r.json();
        const pageRecords = data.data || [];

        // Stop when we hit records older than the window
        const cutoffHit = pageRecords.some(rec =>
          new Date(rec.Modified_Time) < new Date(cutoffTime)
        );

        // Keep all records (we upsert regardless of Created_Time; Supabase
        // can filter by FY on read)
        records = records.concat(pageRecords);

        if (cutoffHit) break;
        more = data.info?.more_records || false;
        pageToken = data.info?.next_page_token || null;
        page++;
      }

      // 16-Oct-2026: a call / task / note on a deal moves Last_Activity_Time but often NOT Modified_Time,
      // so the Modified_Time pass above misses it. Also pick up every deal with activity inside the window.
      // Never fails the sync.
      try {
        const since = istIso(cutoffTime);
        for (let off = 0; off < 10000 && Date.now() < deadline; off += 2000) {
          const q = `select id, Deal_Name, Account_Name.Account_Name, Owner.first_name, Owner.last_name, Stage, Amount, Probability, Region, Closing_Date, Created_Time, Modified_Time, Last_Activity_Time, Lead_Source, Project_Name, Product_Solution_Type_Multi_Select from Deals where Last_Activity_Time >= '${since}' order by Last_Activity_Time asc limit ${off}, 2000`;
          const { data, more: zMore } = await coql(accessToken, q);
          activityExtra += data.length;
          records = records.concat(data.map(r => ({ id: r.id, Deal_Name: r.Deal_Name, Account_Name: { name: r['Account_Name.Account_Name'] || null }, Owner: { name: ownerName(r) }, Stage: r.Stage, Amount: r.Amount, Probability: r.Probability, Region: r.Region, Closing_Date: r.Closing_Date, Created_Time: r.Created_Time, Modified_Time: r.Modified_Time, Last_Activity_Time: r.Last_Activity_Time, Lead_Source: r.Lead_Source, Project_Name: r.Project_Name, Product_Solution_Type_Multi_Select: r.Product_Solution_Type_Multi_Select || [] })));
          if (!zMore || data.length < 2000) break;
        }
      } catch (e) { activityError = String(e.message || e).slice(0, 200); }
    }

    const written = await supabasePotentials.upsertPotentials(records);

    // Deals deleted in Zoho in the last N days (default 7) -> remove from the cache. Never fails the sync.
    let deletedRemoved = 0, deleteError;
    try {
      const days = parseInt(req.query?.deleted_days || '7', 10);
      const since = Date.now() - days * 86400000;
      const ids = [];
      for (let p = 1; p <= 10 && Date.now() < deadline + 3000; p++) {
        const r = await fetch(`${ZOHO_API_DOMAIN}/crm/v8/Deals/deleted?type=all&per_page=200&page=${p}`, { headers: authHeader });
        if (r.status === 204) break;
        if (!r.ok) throw new Error(`Zoho deleted list ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const data = await r.json();
        const list = data.data || [];
        let older = false;
        list.forEach(x => {
          if (x.deleted_time && new Date(x.deleted_time).getTime() < since) older = true;
          else if (x.id) ids.push(String(x.id));
        });
        if (older || !data.info?.more_records) break;
      }
      if (ids.length) deletedRemoved = await supabasePotentials.deletePotentials(ids);
    } catch (e) { deleteError = e.message; }

    const response = {
      synced: written,
      totalFetched: records.length,
      syncedAt: new Date().toISOString(),
      mode,
      deletedRemoved,
    };
    if (deleteError) response.deleteError = deleteError;

    if (mode === 'incremental') {
      response.windowHours = parseInt(req.query?.window || '48', 10);
      response.activityPicked = activityExtra;
      if (activityError) response.activityError = activityError;
    } else {
      response.lastCreatedAt = lastCreatedAt;
      response.hasMore = more; // true = deadline hit before exhausting records
      response.resumeWith = more && lastCreatedAt
        ? `?mode=full&since_created=${encodeURIComponent(lastCreatedAt)}`
        : null;
    }

    res.status(200).json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
