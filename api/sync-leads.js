const zohoAuth = require('../lib/zohoAuth');
const supabaseLeads = require('../lib/supabaseLeads');

const LEADS_FIELDS = [
  'Full_Name', 'Company', 'Account_Name', 'Owner', 'Lead_Status',
  'Order_Value', 'Product_Solution_Type_Multi_Select',
  'Region', 'Created_Time', 'Modified_Time'
].join(',');

const FY_START = '2025-04-01T00:00:00+05:30';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
    const accessToken = await zohoAuth.getZohoAccessToken();
    const authHeader = { Authorization: `Zoho-oauthtoken ${accessToken}` };

    const fyStart = new Date(FY_START);

    // Support ?window=HOURS for catch-up syncs (default 48h for normal runs)
    const windowHours = parseInt(req.query?.window || '48', 10);
    const cutoffTime = Date.now() - windowHours * 60 * 60 * 1000;

    const PER_PAGE = 200;
    let leads = [];
    let page = 1;
    let pageToken = null;
    let more = true;
    const deadline = Date.now() + 55000; // 55s budget

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

      // Stop when we hit records older than the window
      const cutoffHit = pageRecords.some(rec =>
        new Date(rec.Modified_Time || rec.Created_Time) < new Date(cutoffTime)
      );

      // Only keep leads created within the FY
      const fyFiltered = pageRecords.filter(rec =>
        new Date(rec.Created_Time) >= fyStart
      );
      leads = leads.concat(fyFiltered);

      if (cutoffHit) break;
      more = data.info?.more_records || false;
      pageToken = data.info?.next_page_token || null;
      page++;
    }

    const leadsWritten = await supabaseLeads.upsertLeads(leads);

    const engineers = await zohoAuth.fetchSalesEngineers();
    const engineersWritten = await supabaseLeads.upsertEngineers(engineers);
    await supabaseLeads.pruneEngineers(engineers.map(e => e.id));

    res.status(200).json({
      synced: leadsWritten,
      engineersSynced: engineersWritten,
      syncedAt: new Date().toISOString(),
      mode: `incremental-${windowHours}h`,
      windowHours
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
