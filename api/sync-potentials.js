const zohoAuth = require('../lib/zohoAuth');
const supabasePotentials = require('../lib/supabasePotentials');

const POTENTIALS_FIELDS = [
  'Deal_Name', 'Account_Name', 'Owner', 'Stage', 'Amount',
  'Product_Solution_Type_Multi_Select', 'Region',
  'Created_Time', 'Modified_Time', 'Closing_Date', 'Probability'
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

    if (mode === 'full') {
      // ── FULL FY SCAN ──────────────────────────────────────────────────────
      // Fetches records by Created_Time ASC from FY_START (or since_created).
      // Paginate until we exhaust records or hit the deadline.
      // The caller can pass ?since_created=ISO to resume after a partial run.
      const sinceCreated = req.query?.since_created || FY_START;

      while (more && Date.now() < deadline) {
        // Zoho COQL-style date range on Created_Time via search criteria
        // We use the regular records API with Created_Time range filter
        let url = `${ZOHO_API_DOMAIN}/crm/v8/Deals?fields=${POTENTIALS_FIELDS}&per_page=${PER_PAGE}&sort_by=Created_Time&sort_order=asc`;
        // Use search criteria to filter by Created_Time >= sinceCreated
        // Zoho supports: /Deals/search?criteria=(Created_Time:greater_equal:VALUE)
        // For pagination after the first page we switch to page_token
        if (!pageToken) {
          url = `${ZOHO_API_DOMAIN}/crm/v8/Deals/search?criteria=(Created_Time:greater_equal:${encodeURIComponent(sinceCreated)})&fields=${POTENTIALS_FIELDS}&per_page=${PER_PAGE}&sort_by=Created_Time&sort_order=asc`;
        } else {
          url = `${ZOHO_API_DOMAIN}/crm/v8/Deals/search?criteria=(Created_Time:greater_equal:${encodeURIComponent(sinceCreated)})&fields=${POTENTIALS_FIELDS}&per_page=${PER_PAGE}&sort_by=Created_Time&sort_order=asc&page_token=${pageToken}`;
        }

        const r = await fetch(url, { headers: authHeader });
        if (r.status === 204) break;
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`Zoho fetch failed: ${r.status} ${t}`);
        }
        const data = await r.json();
        const pageRecords = data.data || [];

        records = records.concat(pageRecords);
        if (pageRecords.length > 0) {
          lastCreatedAt = pageRecords[pageRecords.length - 1].Created_Time;
        }

        more = data.info?.more_records || false;
        pageToken = data.info?.next_page_token || null;
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
    }

    const written = await supabasePotentials.upsertPotentials(records);

    const response = {
      synced: written,
      totalFetched: records.length,
      syncedAt: new Date().toISOString(),
      mode,
    };

    if (mode === 'incremental') {
      response.windowHours = parseInt(req.query?.window || '48', 10);
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
