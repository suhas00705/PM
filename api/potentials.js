// api/potentials.js
// Reads pre-synced Deals (Potentials) from Supabase.
// Region filtering: reads pm_regions cookie set by the auth layer after Google login.
const supabasePotentials = require('../lib/supabasePotentials');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Parse allowed regions from the pm_regions cookie (set after Google login)
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
