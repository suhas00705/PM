// lib/appUsers.js (24-Oct-2026) – Control tab: list Elmeasure Insights app users, block / unblock, rename.
// Served through /api/app-otp (actions 'list' and 'set') – the Vercel Hobby plan allows only 12 API functions.
//   POST {pin, action:'list'}
//   POST {pin, action:'set', mobile, is_active?, name?}
// The PIN is the Vercel environment variable CONTROL_PIN. Since 26-Oct-2026 the admin's portal Google sign-in
// (token) also opens it, and 'set' can approve a pending user: {status:'approved'}.
const { sb, cleanMobile, cleanName, body } = require('./appAuth');
const { readToken, ADMIN_EMAIL } = require('./portalSession');
const APP_TABS = ['leads','potentials','cpanalytics','pmtracking','oemtracking','salestracking','pathtarget','regiontrack','lvs'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const b = body(req);
  const pin = process.env.CONTROL_PIN;
  const admin = readToken(b.token) === ADMIN_EMAIL;
  if (!admin) {
    if (!pin) return res.status(500).json({ error: 'Server not set up: add CONTROL_PIN in Vercel → Settings → Environment Variables, then redeploy.' });
    if (String(b.pin || '') !== pin) { await new Promise(r => setTimeout(r, 800)); return res.status(403).json({ error: 'Wrong PIN' }); }
  }
  try {
    if (b.action === 'list') {
      const users = (await sb('app_users?select=*&order=registered_at.desc')).map(u => { delete u.token_hash; return u; });
      return res.status(200).json({ ok: true, users, tabs: APP_TABS, admin_mobile: '6366908219' });
    }
    if (b.action === 'set') {
      const mobile = cleanMobile(b.mobile);
      if (!mobile) return res.status(400).json({ error: 'Bad mobile' });
      const patch = {};
      if (typeof b.is_active === 'boolean') { patch.is_active = b.is_active; if (!b.is_active) patch.token_hash = null; }
      if (b.name !== undefined) { const n = cleanName(b.name); if (n.length >= 2) patch.name = n; }
      if (b.status === 'approved' || b.status === 'pending') patch.status = b.status;
      if (Array.isArray(b.allowed_tabs)) patch.allowed_tabs = b.allowed_tabs.filter(t => APP_TABS.includes(t));
      if (Array.isArray(b.allowed_regions)) patch.allowed_regions = b.allowed_regions.map(String).slice(0, 200);
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });
      await sb(`app_users?mobile=eq.${mobile}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
};
