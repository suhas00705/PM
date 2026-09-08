const zohoAuth = require('../lib/zohoAuth');
const supabasePotentials = require('../lib/supabasePotentials');

const POTENTIALS_FIELDS = [
  'Deal_Name', 'Account_Name', 'Owner', 'Region', 'Amount', 'Stage', 'Probability',
  'Product_Solution_Type_Multi_Select', 'Created_Time'
].join(',');

const FY_START = '2025-04-01T00:00:00+05:30';

function isClosedStage(stage) {
  return (stage || '').trim().toLowerCase().startsWith('closed');
}

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
    let records = [];
    let page = 1;
    let pageToken = null;
    let more = true;
    const deadline = Date.now() + 55000; // 55s budget

    while (more && Date.now() < deadline) {
      let url = `${ZOHO_API_DOMAIN}/crm/v8/Potentials?fields=${POTENTIALS_FIELDS}&per_page=${PER_PAGE}&sort_by=Modified_Time&sort_order=desc`;
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
      const cutoffHit = pageRecords.some(rec => new Date(rec.Modified_Time || rec.Created_Time) < new Date(cutoffTime));

      const fyFiltered = pageRecords.filter(rec =>
        new Date(rec.Created_Time) >= fyStart && !isClosedStage(rec.Stage)
      );
      records = records.concat(fyFiltered);

      if (cutoffHit) break;
      more = data.info?.more_records || false;
      pageToken = data.info?.next_page_token || null;
      page++;
    }

    const written = await supabasePotentials.upsertPotentials(records);
    res.status(200).json({
      synced: written,
      totalFetched: records.length,
      syncedAt: new Date().toISOString(),
      mode: `incremental-${windowHours}h`,
      windowHours
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
