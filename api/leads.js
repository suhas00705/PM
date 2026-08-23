// api/leads.js
// Reads pre-synced leads from Supabase, plus the Sales Engineer name list.
// Also handles ?mode=performance — returns per-basket CRM aggregates
// (leads, pipeline, OB & invoice) without needing a separate api/performance.js
// function (Vercel Hobby plan caps at 12 serverless functions).
const supabaseLeads = require('../lib/supabaseLeads');

// ── Performance mode helpers ──────────────────────────────────────────────────

const SUPABASE_URL  = 'https://xfdfbrfudsaxqgpsdboa.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGZicmZ1ZHNheHFncHNkYm9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTA1MzgsImV4cCI6MjA5NzM2NjUzOH0.sfUC5Mn_d7-FGkvQHyD01kdGM81TjG4VWzXoFv43n94';

const HDRS = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };

const BASKETS = [
  { key: 'lvs',   pmKey: 'lvs',   label: 'LV SwitchGear',         kwds: ['switchgear','switch gear','lvs','lv switch'] },
  { key: 'panel', pmKey: 'panel', label: 'Panel Meters',           kwds: ['panel meter'] },
  { key: 'ates',  pmKey: 'ates',  label: 'ATeS',                   kwds: ['ates','transfer switch','auto transfer','switch transfer'] },
  { key: 'accl',  pmKey: 'accl',  label: 'ACCL',                   kwds: ['accl','power factor','capacitor bank'] },
  { key: 'pm',    pmKey: 'pm',    label: 'Prepaid & Smart Meters',  kwds: ['prepaid','smart meter','smart energy'] },
];

async function fetchAll(table, select, order) {
  const rows = [];
  const PAGE = 1000;
  let from = 0, total = null;
  while (true) {
    const qs = `?select=${encodeURIComponent(select)}${order ? '&order=' + order : ''}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
      headers: { ...HDRS, Range: `${from}-${from + PAGE - 1}` }
    });
    if (!res.ok && res.status !== 206) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (!data.length) break;
    rows.push(...data);
    const cr = res.headers.get('content-range');
    if (cr) { const [,t] = cr.split('/'); if (t && t !== '*') total = parseInt(t, 10); }
    from += data.length;
    if ((total !== null && from >= total) || data.length < PAGE) break;
  }
  return rows;
}

function matchesBasket(productTypes, kwds) {
  if (!productTypes || !productTypes.length) return false;
  return productTypes.some(pt => kwds.some(kw => (pt || '').toLowerCase().includes(kw)));
}

function r1(v) { return Math.round(v * 10) / 10; }

function currentMonthIST() {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return M[new Date(Date.now() + 5.5 * 3600000).getMonth()];
}

function cutoff90() { return new Date(Date.now() - 90 * 86400000).toISOString(); }

async function handlePerformance(res) {
  const [leads, potentials, pmRows] = await Promise.all([
    fetchAll('leads_cache',     'owner_name,lead_status,order_value,region,product_solution_type,created_time', 'created_time.desc'),
    fetchAll('potentials_cache','owner_name,amount,region,product_solution_type,created_time',                  'created_time.desc'),
    fetchAll('PM_Desk',         'id,payload', '')
  ]);

  const pmMap = {};
  pmRows.forEach(r => { if (r.id) pmMap[r.id] = r.payload || {}; });

  const curMonth = currentMonthIST();
  const cut90    = cutoff90();
  const basketResults = {};

  for (const bsk of BASKETS) {
    const bLeads = leads.filter(l => matchesBasket(l.product_solution_type, bsk.kwds));
    const bPots  = potentials.filter(p => matchesBasket(p.product_solution_type, bsk.kwds));
    const pmData = pmMap[bsk.pmKey] || {};

    const leadsByRegion = {}, leadsByOwner = {};
    const activeOwners = new Set(), inactiveOwners = new Set();
    bLeads.forEach(l => {
      const region = (l.region || 'Unknown').trim();
      const owner  = (l.owner_name || 'Unknown').trim();
      leadsByRegion[region] = (leadsByRegion[region] || 0) + 1;
      leadsByOwner[owner]   = (leadsByOwner[owner]   || 0) + 1;
      if (l.created_time && l.created_time >= cut90) activeOwners.add(owner);
      else inactiveOwners.add(owner);
    });

    const potsByRegion = {}, potsByOwner = {};
    let totalPipeline = 0;
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
    activeOwners.forEach(o => inactiveOwners.delete(o));

    const potsByRegionL = {}, potsByOwnerL = {};
    Object.entries(potsByRegion).forEach(([r,v]) => { potsByRegionL[r] = r1(v / 100000); });
    Object.entries(potsByOwner).forEach(([o,v])  => { potsByOwnerL[o] = r1(v / 100000); });

    basketResults[bsk.key] = {
      label: bsk.label, curMonth,
      leads:      { total: bLeads.length, byRegion: leadsByRegion, byOwner: leadsByOwner },
      potentials: { total: bPots.length, pipelineL: r1(totalPipeline / 100000), byRegionL: potsByRegionL, byOwnerL: potsByOwnerL },
      ob:         { thisMonth: r1(pmData.obActuals?.[curMonth]  || 0) },
      invoice:    { thisMonth: r1(pmData.invActuals?.[curMonth] || 0) },
      owners:     { active: [...activeOwners], inactive: [...inactiveOwners] }
    };
  }

  const totalPipelineL = r1(potentials.reduce((s,p) => s + (p.amount || 0), 0) / 100000);
  const totalOB  = r1(Object.values(pmMap).reduce((s,p) => s + (p.obActuals?.[curMonth]  || 0), 0));
  const totalInv = r1(Object.values(pmMap).reduce((s,p) => s + (p.invActuals?.[curMonth] || 0), 0));

  res.status(200).json({
    baskets: basketResults,
    overall: { curMonth, totalLeads: leads.length, totalPotentials: potentials.length, totalPipelineL, totalOB, totalInv },
    syncedAt: new Date().toISOString()
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Performance dashboard mode — same endpoint, different response shape
  if (req.query.mode === 'performance') {
    try { return await handlePerformance(res); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // Normal leads + engineers mode
  try {
    const cookieHeader = req.headers.cookie || '';
    const regionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('pm_regions='));
    const allowedRegions = regionCookie
      ? decodeURIComponent(regionCookie.split('=')[1].trim()).split(',').filter(Boolean)
      : [];

    const [leads, engineers] = await Promise.all([
      supabaseLeads.getCachedLeads(allowedRegions),
      supabaseLeads.getCachedEngineers()
    ]);
    res.status(200).json({ leads, count: leads.length, engineers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
