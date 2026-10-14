// api/potentials.js
// Reads pre-synced Deals (Potentials) from Supabase.
// Server-side region filtering via pm_regions cookie (same pattern as leads.js).
// Also handles ?mode=zoho-lead (POST) — creates a Zoho lead through n8n.
// (builder-projects and jarvis-ask were removed on 14-Oct-2026 with the AI Agents / Jarvis tabs.)
const supabasePotentials = require('../lib/supabasePotentials');
const { sendJson } = require('../lib/gzipJson');

const N8N_ZOHO_LEAD_ENDPOINT = 'https://suhas00705.app.n8n.cloud/webhook/zoho-lead-create';

async function zohoCreateLead(req, res) {
  try {
    const b = req.body || {};
    const company = b.company || b.Company || '';
    const lastName = b.lastName || b.last_name || b.name || '';
    const firstName = b.firstName || b.first_name || '';
    const phone = b.phone || b.Phone || '';
    const email = b.email || b.Email || '';
    const leadSource = b.leadSource || 'Claude AI Voice';
    const status = b.status || 'New';
    const description = b.description || b.notes || '';
    const designation = b.designation || '';

    if (!lastName && !company) {
      return res.status(400).json({ error: 'At least lastName or company is required' });
    }

    const upstream = await fetch(N8N_ZOHO_LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, lastName, firstName, phone, email, leadSource, status, description, designation })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(502).json({ error: `n8n upstream ${upstream.status}: ${text}` });
    }
    const data = await upstream.json();
    const message = data.message || (data.success ? `Lead created: ${firstName} ${lastName} (${company})` : 'Lead processed');
    return res.status(200).json({ success: true, leadId: data.leadId || null, message });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query && req.query.mode === 'zoho-lead') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST required for zoho-lead' });
    }
    if (!req.body) {
      let raw = '';
      await new Promise(resolve => {
        req.on('data', chunk => { raw += chunk; });
        req.on('end', resolve);
      });
      try { req.body = JSON.parse(raw); } catch { req.body = {}; }
    }
    return zohoCreateLead(req, res);
  }


  try {
    const cookieHeader = req.headers.cookie || '';
    const regionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('pm_regions='));
    const allowedRegions = regionCookie
      ? decodeURIComponent(regionCookie.split('=')[1].trim()).split(',').filter(Boolean)
      : [];

    const potentials = await supabasePotentials.getCachedPotentials(allowedRegions);
    return sendJson(req, res, 200, { potentials, count: potentials.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
