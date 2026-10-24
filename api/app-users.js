// api/app-users.js (24-Oct-2026) – Control tab: list Elmeasure Insights app users, block / unblock, rename.
//   POST {pin, action:'list'}
//   POST {pin, action:'set', mobile, is_active?, name?}
// The PIN is the Vercel environment variable CONTROL_PIN.
const { sb, cleanMobile, cleanName, body } = require('../lib/appAuth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const b = body(req);
  const pin = process.env.CONTROL_PIN;
  if (!pin) return res.status(500).json({ error: 'Server not set up: add CONTROL_PIN in Vercel → Settings → Environment Variables, then redeploy.' });
  if (String(b.pin || '') !== pin) { await new Promise(r => setTimeout(r, 800)); return res.status(403).json({ error: 'Wrong PIN' }); }
  try {
    if (b.action === 'list') {
      const users = await sb('app_users?select=mobile,name,is_active,device,registered_at,last_seen,open_count&order=registered_at.desc');
      return res.status(200).json({ ok: true, users });
    }
    if (b.action === 'set') {
      const mobile = cleanMobile(b.mobile);
      if (!mobile) return res.status(400).json({ error: 'Bad mobile' });
      const patch = {};
      if (typeof b.is_active === 'boolean') { patch.is_active = b.is_active; if (!b.is_active) patch.token_hash = null; }
      if (b.name !== undefined) { const n = cleanName(b.name); if (n.length >= 2) patch.name = n; }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });
      await sb(`app_users?mobile=eq.${mobile}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
};
