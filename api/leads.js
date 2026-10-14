// api/leads.js
// Reads pre-synced leads from Supabase, plus the Sales Engineer name list.
// (?mode=performance and its PM_Desk table were removed on 14-Oct-2026 with the AI Agents / Jarvis tabs.)
const supabaseLeads = require('../lib/supabaseLeads');
const { sendJson } = require('../lib/gzipJson');

// ── Shared helpers ──────────────────────────────────────────────────

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


// ── Zoho Lookup mode (GET ?mode=zoho-lookup) ─────────────────────────────────
// Returns channel partner accounts + active CRM users for Create Lead dropdowns.
// Reads directly from Zoho CRM using the shared zohoAuth helper.

const zohoAuth = require('../lib/zohoAuth');

async function handleZohoLookup(res) {
  const ZOHO_API = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
  const token = await zohoAuth.getZohoAccessToken();
  const authHdr = { Authorization: `Zoho-oauthtoken ${token}` };

  // Account types to pull (Channel Partners, Dealers, Distributors, Panel Builders, System Integrators)
  const criteria = encodeURIComponent(
    '((Account_Type:equals:Channel Partners)or' +
    '(Account_Type:equals:Distributor)or' +
    '(Account_Type:equals:Panel Builder)or' +
    '(Account_Type:equals:Dealer)or' +
    '(Account_Type:equals:System Integrators)or' +
    '(Account_Type:equals:PB-Direct))'
  );

  const [acctRes, userRes] = await Promise.all([
    fetch(`${ZOHO_API}/crm/v8/Accounts/search?criteria=${criteria}&fields=id,Account_Name,Account_Type,Phone,Email&per_page=200`, { headers: authHdr }),
    fetch(`${ZOHO_API}/crm/v8/users?type=ActiveUsers&per_page=200`, { headers: authHdr })
  ]);

  // Accounts
  let accounts = [], acctWarn = null;
  if (acctRes.status === 204) {
    acctWarn = 'Zoho accounts returned 204 (no content)';
  } else if (!acctRes.ok) {
    const errText = await acctRes.text();
    acctWarn = `Zoho accounts fetch failed: HTTP ${acctRes.status} — ${errText}`;
    console.error('[zoho-lookup] accounts error:', acctWarn);
  } else {
    const acctData = await acctRes.json();
    if (acctData.code && acctData.code !== 'SUCCESS') {
      acctWarn = `Zoho accounts API error: ${acctData.code} — ${acctData.message || ''}`;
      console.error('[zoho-lookup] accounts API error:', acctWarn);
    } else {
      accounts = (acctData.data || []).map(a => ({
        id:    a.id,
        name:  a.Account_Name || '',
        type:  a.Account_Type || '',
        phone: a.Phone || '',
        email: a.Email || ''
      })).sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  // Users
  const userData = userRes.ok ? await userRes.json() : { users: [] };
  const users = (userData.users || []).map(u => ({
    id:    u.id,
    name:  u.full_name || '',
    email: u.email || ''
  })).sort((a, b) => a.name.localeCompare(b.name));

  return res.status(200).json({ accounts, users, acctWarn: acctWarn || undefined, fetchedAt: new Date().toISOString() });
}

// ── Create Lead mode (POST ?mode=create) ─────────────────────────────────────
// Inserts a new lead into Supabase `portal_leads` table.
// Does NOT push to Zoho CRM.

const PORTAL_LEADS_URL = `${SUPABASE_URL}/rest/v1/portal_leads`;
const SUPABASE_WRITE_HDRS = {
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
};

async function handleCreateLead(req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Invalid JSON' }); } }
  if (!body) return res.status(400).json({ error: 'Empty request body' });
  if (!body.last_name || !body.company || !body.region) {
    return res.status(400).json({ error: 'last_name, company and region are required' });
  }

  const row = {
    salutation:                  body.salutation || null,
    first_name:                  body.first_name || null,
    last_name:                   body.last_name,
    full_name:                   body.full_name || null,
    company:                     body.company,
    designation:                 body.designation || null,
    email:                       body.email || null,
    phone:                       body.phone || null,
    mobile:                      body.mobile || null,
    website:                     body.website || null,
    account_type:                body.account_type || null,
    lead_source:                 body.lead_source || null,
    lead_status:                 body.lead_status || 'Not Contacted',
    priority_levels:             body.priority_levels || null,
    region:                      body.region,
    sub_region:                  body.sub_region || null,
    industry:                    body.industry || null,
    business_type:               body.business_type || null,
    order_type:                  body.order_type || null,
    approach_type:               body.approach_type || null,
    enquiry_date:                body.enquiry_date || null,
    expected_closure_date:       body.expected_closure_date || null,
    order_value:                 (body.order_value != null && body.order_value !== '') ? parseFloat(body.order_value) : null,
    process_stage:               body.process_stage || null,
    product_solution:            body.product_solution || null,
    customer_class:              body.customer_class || null,
    product_solution_type:       Array.isArray(body.product_solution_type) ? body.product_solution_type : [],
    estimation_status:           body.estimation_status || null,
    estimation_support_required: body.estimation_support_required || null,
    bms_support_required:        body.bms_support_required === true,
    project_name:                body.project_name || null,
    end_client_name:             body.end_client_name || null,
    contractor:                  body.contractor || null,
    consultant:                  body.consultant || null,
    street:                      body.street || null,
    city:                        body.city || null,
    state:                       body.state || null,
    zip_code:                    body.zip_code || null,
    country:                     body.country || null,
    customer_enquiry_details:    body.customer_enquiry_details || null,
    remarks:                     body.remarks || null,
    owner_name:                  body.owner_name || null,
    panel_builder:               body.panel_builder || null,
    gp:                          (body.gp != null && body.gp !== '') ? parseFloat(body.gp) : null,
    account_name:                body.account_name || null,
    dealer_name:                 body.dealer_name  || null,
    created_by_email:            body.created_by_email || null,
    source:                      'portal',
    product_lines:               body.product_lines || null,
    created_time:                new Date().toISOString()
  };

  const supaRes = await fetch(PORTAL_LEADS_URL, {
    method: 'POST',
    headers: SUPABASE_WRITE_HDRS,
    body: JSON.stringify(row)
  });

  if (!supaRes.ok) {
    const errText = await supaRes.text();
    console.error('[create-lead] Supabase error:', supaRes.status, errText);
    return res.status(500).json({ error: `Supabase insert failed: ${errText}` });
  }

  const data = await supaRes.json();
  const created = Array.isArray(data) ? data[0] : data;
  return res.status(200).json({ success: true, id: created?.id || null });
}

// ── Update Lead mode (PATCH ?mode=update&id=...) ─────────────────────────────
// Updates an existing portal_leads row in Supabase.

async function handleUpdateLead(req, res) {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id is required' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Invalid JSON' }); } }
  if (!body) return res.status(400).json({ error: 'Empty request body' });

  // Build update patch — only fields present in body
  const patch = {};
  const fields = [
    'salutation','first_name','last_name','full_name','company','designation',
    'email','phone','mobile','website','account_type','lead_source','lead_status',
    'priority_levels','region','sub_region','industry','business_type','order_type',
    'approach_type','enquiry_date','expected_closure_date','order_value','process_stage',
    'product_solution','customer_class','product_solution_type','estimation_status',
    'estimation_support_required','bms_support_required','project_name','end_client_name',
    'contractor','consultant','street','city','state','zip_code','country',
    'customer_enquiry_details','remarks','owner_name','panel_builder','gp',
    'account_name','dealer_name','product_lines'
  ];
  fields.forEach(f => { if (f in body) patch[f] = body[f]; });

  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No fields to update' });

  const supaRes = await fetch(`${PORTAL_LEADS_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...SUPABASE_WRITE_HDRS, Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });

  if (!supaRes.ok) {
    const errText = await supaRes.text();
    console.error('[update-lead] Supabase error:', supaRes.status, errText);
    return res.status(500).json({ error: `Supabase update failed: ${errText}` });
  }

  const data = await supaRes.json();
  const updated = Array.isArray(data) ? data[0] : data;
  return res.status(200).json({ success: true, id: updated?.id || id });
}

// ── Potentials fetch (GET ?mode=potentials) ───────────────────────────────────
// Reads all potentials from potentials_cache for the portal dashboard.

async function handlePotentials(res) {
  const rows = [];
  const PAGE = 1000;
  let from = 0, total = null;
  const select = 'id,Deal_Name,Account_Name,Amount,Stage,Closing_Date,owner_name,region,product_solution_type,created_time,Lead_Source';
  while (true) {
    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/potentials_cache?select=${encodeURIComponent(select)}&order=created_time.desc`,
      { headers: { ...HDRS, Range: `${from}-${from + PAGE - 1}` } }
    );
    if (!supaRes.ok && supaRes.status !== 206) {
      const txt = await supaRes.text();
      throw new Error(`Supabase potentials: ${supaRes.status} ${txt}`);
    }
    const data = await supaRes.json();
    if (!data.length) break;
    rows.push(...data);
    const cr = supaRes.headers.get('content-range');
    if (cr) { const [,t] = cr.split('/'); if (t && t !== '*') total = parseInt(t, 10); }
    from += data.length;
    if ((total !== null && from >= total) || data.length < PAGE) break;
  }
  return res.status(200).json({ potentials: rows, count: rows.length, fetchedAt: new Date().toISOString() });
}

// ── Convert Lead to Potential (POST ?mode=convert&id=...) ─────────────────────
// Creates a Zoho CRM Deal from a portal_leads row, marks lead as converted.

async function handleConvertToPotential(req, res) {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id is required' });

  // Fetch the lead from Supabase
  const leadRes = await fetch(`${PORTAL_LEADS_URL}?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: SUPABASE_WRITE_HDRS
  });
  if (!leadRes.ok) return res.status(500).json({ error: 'Could not fetch lead from Supabase' });
  const leads = await leadRes.json();
  if (!leads.length) return res.status(404).json({ error: 'Lead not found' });
  const lead = leads[0];

  // Build Zoho Deal payload
  const ZOHO_API = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
  const token = await zohoAuth.getZohoAccessToken();
  const authHdr = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' };

  const dealName = [lead.project_name, lead.company].filter(Boolean).join(' — ') || lead.company || 'New Deal';
  const dealPayload = {
    data: [{
      Deal_Name:            dealName,
      Account_Name:         lead.account_name || lead.company || null,
      Amount:               lead.order_value || null,
      Stage:                'Proposal/Price Quote',
      Closing_Date:         lead.expected_closure_date || null,
      Lead_Source:          lead.lead_source || null,
      Description:          lead.customer_enquiry_details || null,
      // Custom fields — add as available in your Zoho org
      ...(lead.region    ? { Region: lead.region }   : {}),
    }]
  };

  const zohoRes = await fetch(`${ZOHO_API}/crm/v8/Deals`, {
    method: 'POST',
    headers: authHdr,
    body: JSON.stringify(dealPayload)
  });
  const zohoData = await zohoRes.json();
  if (!zohoRes.ok || (zohoData.data && zohoData.data[0]?.code && zohoData.data[0].code !== 'SUCCESS')) {
    const msg = zohoData.data?.[0]?.message || zohoData.message || `HTTP ${zohoRes.status}`;
    return res.status(500).json({ error: `Zoho Deal creation failed: ${msg}` });
  }
  const dealId = zohoData.data?.[0]?.details?.id || null;

  // Mark lead as converted in Supabase
  await fetch(`${PORTAL_LEADS_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...SUPABASE_WRITE_HDRS, Prefer: 'return=minimal' },
    body: JSON.stringify({ lead_status: 'Qualified', converted: true, deal_id: dealId })
  });

  return res.status(200).json({ success: true, deal_id: dealId, deal_name: dealName });
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Zoho lookup mode — GET ?mode=zoho-lookup (accounts + users for Create Lead form)
  if (req.method === 'GET' && req.query.mode === 'zoho-lookup') {
    try { return await handleZohoLookup(res); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // Create Lead mode — POST ?mode=create
  if (req.method === 'POST' && req.query.mode === 'create') {
    try { return await handleCreateLead(req, res); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // Update Lead mode — PATCH ?mode=update&id=...
  if ((req.method === 'PATCH' || req.method === 'POST') && req.query.mode === 'update') {
    try { return await handleUpdateLead(req, res); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // Potentials dashboard mode — GET ?mode=potentials
  if (req.method === 'GET' && req.query.mode === 'potentials') {
    try { return await handlePotentials(res); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // Convert lead to potential — POST ?mode=convert&id=...
  if (req.method === 'POST' && req.query.mode === 'convert') {
    try { return await handleConvertToPotential(req, res); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // Normal leads + engineers mode
  try {
    const cookieHeader = req.headers.cookie || '';
    const regionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('pm_regions='));
    const allowedRegions = regionCookie
      ? decodeURIComponent(regionCookie.split('=')[1].trim()).split(',').filter(Boolean)
      : [];

    // Run leads and engineers fetches independently so a broken engineers_cache
    // table never takes down the entire Leads tab.
    let leads = [], engineers = [];
    const [leadsResult, engResult] = await Promise.allSettled([
      supabaseLeads.getCachedLeads(allowedRegions),
      supabaseLeads.getCachedEngineers()
    ]);
    if (leadsResult.status === 'fulfilled') {
      leads = leadsResult.value;
    } else {
      // Leads fetch failed — surface the real error so it's visible in the browser
      return res.status(500).json({ error: leadsResult.reason?.message || 'Leads fetch failed' });
    }
    if (engResult.status === 'fulfilled') {
      engineers = engResult.value;
    }
    // engineers failure is non-fatal — return leads with empty engineers list
    return sendJson(req, res, 200, { leads, count: leads.length, engineers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
