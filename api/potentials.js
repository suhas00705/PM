// api/potentials.js
// Reads pre-synced Deals (Potentials) from Supabase.
// Server-side region filtering via pm_regions cookie (same pattern as leads.js).
// Also handles:
//   ?mode=builder-projects        — proxies the n8n Bangalore Builder Project
//                                    Prospecting agent's data table
//   ?mode=jarvis-ask (POST)       — proxies the n8n Jarvis Q&A agent
// ...without needing separate api/*.js functions (Vercel Hobby plan caps at
// 12 serverless functions).
const supabasePotentials = require('../lib/supabasePotentials');

const N8N_BUILDER_PROJECTS_ENDPOINT = 'https://suhas00705.app.n8n.cloud/webhook/bangalore-builder-projects';
const N8N_JARVIS_ASK_ENDPOINT = 'https://suhas00705.app.n8n.cloud/webhook/jarvis-ask';

async function getBuilderProjects(res) {
  try {
    const upstream = await fetch(N8N_BUILDER_PROJECTS_ENDPOINT);
    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(502).json({ error: `n8n upstream ${upstream.status}: ${text}` });
    }
    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function jarvisAsk(req, res) {
  try {
    const question = (req.body && req.body.question) || '';
    if (!question.trim()) {
      return res.status(400).json({ error: 'Missing question' });
    }
    const upstream = await fetch(N8N_JARVIS_ASK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(502).json({ error: `n8n upstream ${upstream.status}: ${text}` });
    }
    const data = await upstream.json();
    // n8n returns { answer: "..." } or the first item's output field
    const answer = data.answer || (Array.isArray(data) && data[0]?.answer) || JSON.stringify(data);
    return res.status(200).json({ answer });
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

  if (req.query && req.query.mode === 'builder-projects') {
    return getBuilderProjects(res);
  }

  if (req.query && req.query.mode === 'jarvis-ask') {
    // Parse body if not already parsed
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST required for jarvis-ask' });
    }
    if (!req.body) {
      // Manually parse JSON body
      let raw = '';
      await new Promise(resolve => {
        req.on('data', chunk => { raw += chunk; });
        req.on('end', resolve);
      });
      try { req.body = JSON.parse(raw); } catch { req.body = {}; }
    }
    return jarvisAsk(req, res);
  }

  try {
    const cookieHeader = req.headers.cookie || '';
    const regionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('pm_regions='));
    const allowedRegions = regionCookie
      ? decodeURIComponent(regionCookie.split('=')[1].trim()).split(',').filter(Boolean)
      : [];

    const potentials = await supabasePotentials.getCachedPotentials(allowedRegions);
    res.status(200).json({ potentials, count: potentials.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
