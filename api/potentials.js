// api/potentials.js
// Reads pre-synced Deals (Potentials) from Supabase.
// Server-side region filtering via pm_regions cookie (same pattern as leads.js).
const supabasePotentials = require('../lib/supabasePotentials');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
