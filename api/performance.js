// api/performance.js — Aggregated CRM performance per product basket
// Reads from Supabase cache (leads_cache, potentials_cache, PM_Desk).
// No Zoho calls — purely from pre-synced data. Fast read-only endpoint.

const SUPABASE_URL = 'https://xfdfbrfudsaxqgpsdboa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGZicmZ1ZHNheHFncHNkYm9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTA1MzgsImV4cCI6MjA5NzM2NjUzOH0.sfUC5Mn_d7-FGkvQHyD01kdGM81TjG4VWzXoFv43n94';

const HDRS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`
};

// Basket definitions — kwds are matched against product_solution_type[] array values (case-insensitive)
const BASKETS = [
  { key: 'lvs',   pmKey: 'lvs',   label: 'LV SwitchGear',         kwds: ['switchgear', 'switch gear', 'lvs', 'lv switch'] },
  { key: 'panel', pmKey: 'panel', label: 'Panel Meters',           kwds: ['panel meter'] },
  { key: 'ates',  pmKey: 'ates',  label: 'ATeS',                  kwds: ['ates', 'transfer switch', 'auto transfer', 'switch transfer'] },
  { key: 'accl',  pmKey: 'accl',  label: 'ACCL',                  kwds: ['accl', 'power factor', 'capacitor bank'] },
  { key: 'pm',    pmKey: 'pm',    label: 'Prepaid & Smart Meters', kwds: ['prepaid', 'smart meter', 'smart energy'] },
];

// Returns IST month abbreviation for the current moment (e.g. "Aug")
function currentMonthIST() {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return MONTHS[ist.getMonth()];
}

// ISO timestamp 90 days ago (for active-owner classification)
function cutoff90Days() {
  return new Date(Date.now() - 90 * 86400000).toISOString();
}

// Paginate a Supabase REST endpoint in 1000-row chunks
async function fetchAll(path, select, order = '') {
  const rows = [];
  const PAGE = 1000;
  let from = 0, total = null;
  while (true) {
    const qs = `?select=${encodeURIComponent(select)}${order ? '&order=' + order : ''}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${qs}`, {
      headers: { ...HDRS, Range: `${from}-${from + PAGE - 1}` }
    });
    if (!res.ok && res.status !== 206) throw new Error(`Supabase ${path} failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (!data.length) break;
    rows.push(...data);
    const cr = res.headers.get('content-range');
    if (cr) {
      const [, t] = cr.split('/');
      if (t && t !== '*') total = parseInt(t, 10);
    }
    from += data.length;
    if ((total !== null && from >= total) || data.length < PAGE) break;
  }
  return rows;
}

// Case-insensitive keyword match on a TEXT[] field
function matchesBasket(productTypes, kwds) {
  if (!productTypes || !productTypes.length) return false;
  return productTypes.some(pt =>
    kwds.some(kw => (pt || '').toLowerCase().includes(kw))
  );
}

// Round to 1 decimal
function r1(v) { return Math.round(v * 10) / 10; }

// Format amount: returns value in lakhs (2-decimal string)
function toL(v) { return r1(v / 100000); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [leads, potentials, pmRows] = await Promise.all([
      fetchAll(
        'leads_cache',
        'owner_name,lead_status,order_value,region,product_solution_type,created_time',
        'created_time.desc'
      ),
      fetchAll(
        'potentials_cache',
        'owner_name,amount,region,product_solution_type,created_time',
        'created_time.desc'
      ),
      fetchAll('PM_Desk', 'id,payload')
    ]);

    // Build PM_Desk map: id → payload
    const pmMap = {};
    pmRows.forEach(r => { if (r.id) pmMap[r.id] = r.payload || {}; });

    const curMonth = currentMonthIST();
    const cut90 = cutoff90Days();

    const basketResults = {};

    for (const bsk of BASKETS) {
      const bLeads = leads.filter(l => matchesBasket(l.product_solution_type, bsk.kwds));
      const bPots  = potentials.filter(p => matchesBasket(p.product_solution_type, bsk.kwds));
      const pmData = pmMap[bsk.pmKey] || {};

      // --- Leads aggregation ---
      const leadsByRegion = {};
      const leadsByOwner  = {};
      const activeOwners  = new Set();
      const inactiveOwners = new Set();

      bLeads.forEach(l => {
        const region = (l.region || 'Unknown').trim();
        const owner  = (l.owner_name || 'Unknown').trim();
        leadsByRegion[region] = (leadsByRegion[region] || 0) + 1;
        leadsByOwner[owner]   = (leadsByOwner[owner]   || 0) + 1;
        if (l.created_time && l.created_time >= cut90) activeOwners.add(owner);
        else inactiveOwners.add(owner);
      });

      // --- Potentials aggregation ---
      const potsByRegion = {};
      const potsByOwner  = {};
      let totalPipeline  = 0;

      bPots.forEach(p => {
        const region = (p.region || 'Unknown').trim();
        const owner  = (p.owner_name || 'Unknown').trim();
        const amt    = p.amount || 0;
        potsByRegion[region] = (potsByRegion[region] || 0) + amt;
        potsByOwner[owner]   = (potsByOwner[owner]   || 0) + amt;
        totalPipeline += amt;
        if (p.created_time && p.created_time >= cut90) activeOwners.add(owner);
        else inactiveOwners.add(owner);
      });

      // Any owner that has recent activity is not inactive
      activeOwners.forEach(o => inactiveOwners.delete(o));

      // --- OB & Invoice from PM_Desk (values in lakhs) ---
      const obThisMonth  = r1(pmData.obActuals?.[curMonth]  || 0);
      const invThisMonth = r1(pmData.invActuals?.[curMonth] || 0);

      // Convert potentials amounts to lakhs for display
      const potsByRegionL = {};
      Object.entries(potsByRegion).forEach(([r, v]) => { potsByRegionL[r] = r1(v / 100000); });
      const potsByOwnerL = {};
      Object.entries(potsByOwner).forEach(([o, v]) => { potsByOwnerL[o] = r1(v / 100000); });

      basketResults[bsk.key] = {
        label: bsk.label,
        curMonth,
        leads: {
          total: bLeads.length,
          byRegion: leadsByRegion,
          byOwner:  leadsByOwner
        },
        potentials: {
          total: bPots.length,
          pipelineL: r1(totalPipeline / 100000),  // in lakhs
          byRegionL: potsByRegionL,
          byOwnerL:  potsByOwnerL
        },
        ob:      { thisMonth: obThisMonth },
        invoice: { thisMonth: invThisMonth },
        owners: {
          active:   [...activeOwners],
          inactive: [...inactiveOwners]
        }
      };
    }

    // Overall totals (Suhas view)
    const totalLeads      = leads.length;
    const totalPotentials = potentials.length;
    const totalPipelineL  = r1(potentials.reduce((s, p) => s + (p.amount || 0), 0) / 100000);
    const totalOB  = r1(Object.values(pmMap).reduce((s, p) => s + (p.obActuals?.[curMonth]  || 0), 0));
    const totalInv = r1(Object.values(pmMap).reduce((s, p) => s + (p.invActuals?.[curMonth] || 0), 0));

    res.status(200).json({
      baskets: basketResults,
      overall: { curMonth, totalLeads, totalPotentials, totalPipelineL, totalOB, totalInv },
      syncedAt: new Date().toISOString()
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
