const zohoAuth = require('../lib/zohoAuth');
const supabasePotentials = require('../lib/supabasePotentials');

const POTENTIALS_FIELDS = [
  'Deal_Name', 'Account_Name', 'Owner', 'Stage', 'Amount',
  'Product_Solution_Type_Multi_Select', 'Region',
  'Created_Time', 'Modified_Time', 'Closing_Date', 'Probability'
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
      // COQL, ordered by Created_Time, walking forward with a cursor (2,000 rows per call).
      // default starts far back: old deals still count if their closing date is in this FY or later
      let cursor = req.query?.since_created || '2010-01-01T00:00:00+05:30';
      const seen = new Set();
      more = true;
      while (Date.now() < deadline) {
        const q = `select id, Deal_Name, Account_Name.Account_Name, Owner.first_name, Owner.last_name, Stage, Amount, Probability, Region, Closing_Date, Created_Time, Modified_Time, Product_Solution_Type_Multi_Select from Deals where (Created_Time >= '${FY_START}' or Closing_Date >= '${FY_START.substring(0, 10)}') and Created_Time >= '${cursor}' order by Created_Time asc limit 2000`;
        const { data, more: zMore } = await coql(accessToken, q);
        const fresh = data.filter(rec => !seen.has(rec.id));
        fresh.forEach(rec => seen.add(rec.id));
        records = records.concat(fresh.map(r => ({ id: r.id, Deal_Name: r.Deal_Name, Account_Name: { name: r['Account_Name.Account_Name'] || null }, Owner: { name: ownerName(r) }, Stage: r.Stage, Amount: r.Amount, Probability: r.Probability, Region: r.Region, Closing_Date: r.Closing_Date, Created_Time: r.Created_Time, Product_Solution_Type_Multi_Select: r.Product_Solution_Type_Multi_Select || [] })));
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
