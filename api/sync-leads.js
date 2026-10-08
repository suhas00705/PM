const zohoAuth = require('../lib/zohoAuth');
const supabaseLeads = require('../lib/supabaseLeads');

const LEADS_FIELDS = [
  'Full_Name', 'Company', 'Account_Name', 'Owner', 'Lead_Status',
  'Order_Value', 'Product_Solution_Type_Multi_Select',
  'Region', 'Created_Time', 'Modified_Time'
].join(',');

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
function nextSecond(ts) {
  const t = new Date(new Date(ts).getTime() + 1000 + 19800000);
  return t.toISOString().substring(0, 19) + '+05:30';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
    const accessToken = await zohoAuth.getZohoAccessToken();
    const authHeader = { Authorization: `Zoho-oauthtoken ${accessToken}` };

    // ─── MODE SELECTION ───────────────────────────────────────────────────────
    // ?mode=full   → Full FY scan sorted by Created_Time ASC (no time cutoff).
    //                Catches ALL records including old ones with changed statuses.
    //                Supports ?since_created=ISO_DATE to resume from a point.
    //
    // ?mode=incremental (default)
    //             → Sort by Modified_Time DESC, stop at window cutoff (default 48h).
    //                Quickly catches status changes on any recently-touched lead.
    //                Used for daily syncs.
    // ─────────────────────────────────────────────────────────────────────────

    const mode = req.query?.mode || 'incremental';
    const PER_PAGE = 200;
    const deadline = Date.now() + 55000; // 55s budget

    let leads = [];
    let page = 1;
    let pageToken = null;
    let more = true;
    let lastCreatedAt = null;

    if (mode === 'full') {
      // ── FULL FY SCAN ──────────────────────────────────────────────────────
      // COQL, ordered by Created_Time, walking forward with a cursor (2,000 rows per call).
      let cursor = req.query?.since_created || FY_START;
      const seen = new Set();
      more = true;
      while (Date.now() < deadline) {
        const q = `select id, Full_Name, Company, Account_Name, Owner.first_name, Owner.last_name, Lead_Status, Order_Value, Product_Solution_Type_Multi_Select, Region, Created_Time from Leads where (Created_Time >= '${FY_START}') and Created_Time >= '${cursor}' order by Created_Time asc limit 2000`;
        const { data, more: zMore } = await coql(accessToken, q);
        const fresh = data.filter(rec => !seen.has(rec.id));
        fresh.forEach(rec => seen.add(rec.id));
        leads = leads.concat(fresh.map(r => ({ id: r.id, Full_Name: r.Full_Name, Company: r.Company, Account_Name: r.Account_Name, Owner: { name: ownerName(r) }, Lead_Status: r.Lead_Status, Order_Value: r.Order_Value, Region: r.Region, Product_Solution_Type_Multi_Select: r.Product_Solution_Type_Multi_Select || [], Created_Time: r.Created_Time })));
        if (data.length) lastCreatedAt = data[data.length - 1].Created_Time;
        if (!zMore || data.length < 2000) { more = false; break; }
        cursor = (!fresh.length || lastCreatedAt === cursor) ? nextSecond(cursor) : lastCreatedAt;
      }

    } else {
      // ── INCREMENTAL MODE (default) ────────────────────────────────────────
      const windowHours = parseInt(req.query?.window || '48', 10);
      const cutoffTime = Date.now() - windowHours * 60 * 60 * 1000;

      while (more && Date.now() < deadline) {
        let url = `${ZOHO_API_DOMAIN}/crm/v8/Leads?fields=${LEADS_FIELDS}&per_page=${PER_PAGE}&sort_by=Modified_Time&sort_order=desc`;
        url += pageToken ? `&page_token=${pageToken}` : `&page=${page}`;

        const r = await fetch(url, { headers: authHeader });
        if (r.status === 204) break;
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`Zoho fetch failed: ${r.status} ${t}`);
        }
        const data = await r.json();
        const pageRecords = data.data || [];

        const cutoffHit = pageRecords.some(rec =>
          new Date(rec.Modified_Time) < new Date(cutoffTime)
        );

        leads = leads.concat(pageRecords);

        if (cutoffHit) break;
        more = data.info?.more_records || false;
        pageToken = data.info?.next_page_token || null;
        page++;
      }
    }

    // never send the same lead twice in one upsert (Postgres rejects it)
    leads = [...new Map(leads.filter(l => l && l.id).map(l => [String(l.id), l])).values()];
    const leadsWritten = await supabaseLeads.upsertLeads(leads);

    // Always refresh engineers list
    const engineers = await zohoAuth.fetchSalesEngineers();
    const engineersWritten = await supabaseLeads.upsertEngineers(engineers);
    await supabaseLeads.pruneEngineers(engineers.map(e => e.id));

    const response = {
      synced: leadsWritten,
      engineersSynced: engineersWritten,
      totalFetched: leads.length,
      syncedAt: new Date().toISOString(),
      mode,
    };

    if (mode === 'incremental') {
      response.windowHours = parseInt(req.query?.window || '48', 10);
    } else {
      response.lastCreatedAt = lastCreatedAt;
      response.hasMore = more;
      response.resumeWith = more && lastCreatedAt
        ? `?mode=full&since_created=${encodeURIComponent(lastCreatedAt)}`
        : null;
    }

    res.status(200).json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
