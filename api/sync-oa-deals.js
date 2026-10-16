// Sync Zoho Sales Orders (OAs) with the deal they belong to -> Supabase table oa_deal_link.
// Used by Path to Target "Lead proactiveness": how long the deal existed in Zoho before the OA.
//   ?mode=incremental (default) : OAs modified in the last ?window hours (default 72)
//   ?mode=full                  : every OA dated from 1-Apr-2025, walked by Created_Time
//                                 (resume with ?mode=full&since_created=... while hasMore is true)
const zohoAuth = require('../lib/zohoAuth');

const SUPABASE_URL = 'https://xfdfbrfudsaxqgpsdboa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGZicmZ1ZHNheHFncHNkYm9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTA1MzgsImV4cCI6MjA5NzM2NjUzOH0.sfUC5Mn_d7-FGkvQHyD01kdGM81TjG4VWzXoFv43n94';
const FY_START_DATE = '2025-04-01';
const FY_START = '2025-04-01T00:00:00+05:30';
const FIELDS = 'id, SAP_OA_No, OA_Date, Status, Subject, Region, Grand_Total, Modified_Time, Created_Time, '
  + 'Owner.first_name, Owner.last_name, Account_Name.Account_Name, Deal_Name, Deal_Name.Created_Time, '
  + 'Deal_Name.Closing_Date, Deal_Name.Lead_Source';

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
const istIso = ms => new Date(ms + 19800000).toISOString().substring(0, 19) + '+05:30';
function nextSecond(ts) { return istIso(new Date(ts).getTime() + 1000); }

function toRow(r) {
  const owner = [r['Owner.first_name'], r['Owner.last_name']].filter(Boolean).join(' ') || null;
  return {
    so_id: String(r.id),
    sap_oa_no: r.SAP_OA_No ? String(r.SAP_OA_No).trim() : null,
    oa_date: r.OA_Date || null,
    status: r.Status || null,
    subject: r.Subject || null,
    account: r['Account_Name.Account_Name'] || null,
    region: r.Region || null,
    owner,
    grand_total: r.Grand_Total ?? null,
    deal_id: r.Deal_Name?.id ? String(r.Deal_Name.id) : null,
    deal_name: r.Deal_Name?.name || null,
    deal_created: r['Deal_Name.Created_Time'] || null,
    deal_closing: r['Deal_Name.Closing_Date'] || null,
    deal_source: r['Deal_Name.Lead_Source'] || null,
    modified_time: r.Modified_Time || null,
    synced_at: new Date().toISOString()
  };
}

async function upsert(rows) {
  const byId = new Map(rows.map(r => [r.so_id, r]));
  const all = [...byId.values()];
  let written = 0;
  for (let i = 0; i < all.length; i += 500) {
    const batch = all.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/oa_deal_link?on_conflict=so_id`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json',
                 Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch)
    });
    if (!res.ok) throw new Error(`Supabase oa_deal_link upsert failed (batch ${i}): ${res.status} ${(await res.text()).slice(0, 300)}`);
    written += batch.length;
  }
  return written;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const token = await zohoAuth.getZohoAccessToken();
    const mode = req.query?.mode || 'incremental';
    const deadline = Date.now() + 50000;
    let rows = [], more = false, lastCreatedAt = null;

    if (mode === 'full') {
      let cursor = req.query?.since_created || '2015-01-01T00:00:00+05:30';
      const seen = new Set(); more = true;
      while (Date.now() < deadline) {
        const q = `select ${FIELDS} from Sales_Orders where OA_Date >= '${FY_START_DATE}' and Created_Time >= '${cursor}' order by Created_Time asc limit 2000`;
        const { data, more: zMore } = await coql(token, q);
        const fresh = data.filter(r => !seen.has(r.id));
        fresh.forEach(r => seen.add(r.id));
        rows = rows.concat(fresh.map(toRow));
        if (data.length) lastCreatedAt = data[data.length - 1].Created_Time;
        if (!zMore || data.length < 2000) { more = false; break; }
        cursor = (!fresh.length || lastCreatedAt === cursor) ? nextSecond(cursor) : lastCreatedAt;
      }
    } else {
      const windowHours = parseInt(req.query?.window || '72', 10);
      const since = istIso(Date.now() - windowHours * 3600 * 1000);
      for (let off = 0; off < 10000 && Date.now() < deadline; off += 2000) {
        const q = `select ${FIELDS} from Sales_Orders where Modified_Time >= '${since}' and OA_Date >= '${FY_START_DATE}' order by Modified_Time asc limit ${off}, 2000`;
        const { data, more: zMore } = await coql(token, q);
        rows = rows.concat(data.map(toRow));
        if (!zMore || data.length < 2000) break;
      }
    }

    const written = await upsert(rows);
    const out = { synced: written, fetched: rows.length, mode, syncedAt: new Date().toISOString() };
    if (mode === 'full') {
      out.lastCreatedAt = lastCreatedAt;
      out.hasMore = more;
      out.resumeWith = more && lastCreatedAt ? `?mode=full&since_created=${encodeURIComponent(lastCreatedAt)}` : null;
    } else out.windowHours = parseInt(req.query?.window || '72', 10);
    res.status(200).json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
