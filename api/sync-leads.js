const zohoAuth = require('../lib/zohoAuth');
const supabaseLeads = require('../lib/supabaseLeads');

const LEADS_FIELDS = [
  'Full_Name', 'Company', 'Account_Name', 'Owner', 'Lead_Status',
  'Order_Value', 'Product_Solution_Type_Multi_Select',
  'Region', 'Created_Time', 'Modified_Time'
].join(',');

// FY2025-26 starts April 1, 2025 (IST)
const FY_START = '2025-04-01T00:00:00+05:30';

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
      const sinceCreated = req.query?.since_created || FY_START;

      while (more && Date.now() < deadline) {
        let url;
        if (!pageToken) {
          url = `${ZOHO_API_DOMAIN}/crm/v8/Leads/search?criteria=(Created_Time:greater_equal:${encodeURIComponent(sinceCreated)})&fields=${LEADS_FIELDS}&per_page=${PER_PAGE}&sort_by=Created_Time&sort_order=asc`;
        } else {
          url = `${ZOHO_API_DOMAIN}/crm/v8/Leads/search?criteria=(Created_Time:greater_equal:${encodeURIComponent(sinceCreated)})&fields=${LEADS_FIELDS}&per_page=${PER_PAGE}&sort_by=Created_Time&sort_order=asc&page_token=${pageToken}`;
        }

        const r = await fetch(url, { headers: authHeader });
        if (r.status === 204) break;
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`Zoho fetch failed: ${r.status} ${t}`);
        }
        const data = await r.json();
        const pageRecords = data.data || [];

        leads = leads.concat(pageRecords);
        if (pageRecords.length > 0) {
          lastCreatedAt = pageRecords[pageRecords.length - 1].Created_Time;
        }

        more = data.info?.more_records || false;
        pageToken = data.info?.next_page_token || null;
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
