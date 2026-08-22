// api/leads.js
// Reads pre-synced FY2025-26 + FY2026-27 leads from Supabase, plus the
// current Sales Engineer name list (also auto-synced daily from Zoho, so
// the Engineer filter never needs a manual code update again).
// Region filtering: reads pm_regions cookie set by the auth layer after Google login.
const supabaseLeads = require('../lib/supabaseLeads');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Parse allowed regions from the pm_regions cookie (set after Google login)
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
