// api/app-otp.js (24-Oct-2026) – Elmeasure Insights app: register a mobile number with an SMS OTP.
//   POST {action:'send',   mobile, name}           → sends a 6-digit OTP (valid 10 min)
//   POST {action:'verify', mobile, name, otp, device} → registers the user, returns {token}
//   POST {action:'check',  mobile, token}          → is this app still registered and active? (updates last seen)
//   POST {pin, action:'list' | 'set', ...}          → Control tab (lib/appUsers.js; one function because Hobby allows 12)
// Limits: 3 OTPs per number per 15 minutes, 5 wrong tries per OTP.
const { sb, sha, cleanMobile, cleanName, body, sendSms, crypto } = require('../lib/appAuth');

const enc = encodeURIComponent;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const b = body(req);
  if (b.action === 'list' || b.action === 'set') return require('../lib/appUsers')(req, res);   // Control tab (PIN-protected)
  const mobile = cleanMobile(b.mobile);
  if (!mobile) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  try {
    if (b.action === 'send') {
      const name = cleanName(b.name);
      if (name.length < 2) return res.status(400).json({ error: 'Enter your name.' });
      const now = Date.now();
      const [row] = await sb(`app_otp?mobile=eq.${mobile}&select=*`);
      let sends = row ? row.sends : 0, win = row ? Date.parse(row.window_start) : now;
      if (now - win > 15 * 60000) { sends = 0; win = now; }
      if (sends >= 3) return res.status(429).json({ error: 'Too many OTP requests. Try again in 15 minutes.' });
      const otp = String(crypto.randomInt(100000, 1000000));
      await sb('app_otp?on_conflict=mobile', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ mobile, code_hash: sha(mobile + ':' + otp), expires_at: new Date(now + 10 * 60000).toISOString(),
                               tries: 0, sends: sends + 1, window_start: new Date(win).toISOString() }) });
      await sendSms(mobile, otp);
      return res.status(200).json({ ok: true, sent: true, mobile: mobile.replace(/^(\d{2})\d{5}/, '$1•••••') });
    }

    if (b.action === 'verify') {
      const name = cleanName(b.name), otp = String(b.otp || '').replace(/\D/g, '');
      const [row] = await sb(`app_otp?mobile=eq.${mobile}&select=*`);
      if (!row || !row.code_hash) return res.status(400).json({ error: 'Request an OTP first.' });
      if (Date.parse(row.expires_at) < Date.now()) return res.status(400).json({ error: 'OTP expired. Request a new one.' });
      if (row.tries >= 5) return res.status(429).json({ error: 'Too many wrong tries. Request a new OTP.' });
      if (sha(mobile + ':' + otp) !== row.code_hash) {
        await sb(`app_otp?mobile=eq.${mobile}`, { method: 'PATCH', body: JSON.stringify({ tries: row.tries + 1 }) });
        return res.status(400).json({ error: `Wrong OTP. ${4 - row.tries} tries left.` });
      }
      const [old] = await sb(`app_users?mobile=eq.${mobile}&select=is_active,name`);
      if (old && old.is_active === false) return res.status(403).json({ error: 'This number has been blocked. Contact the administrator.' });
      const token = crypto.randomBytes(24).toString('hex');
      await sb('app_users?on_conflict=mobile', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ mobile, name: name || (old && old.name) || 'User', token_hash: sha(token),
                               device: String(b.device || '').slice(0, 120), last_seen: new Date().toISOString(),
                               ...(old ? {} : { registered_at: new Date().toISOString(), is_active: true }) }) });
      await sb(`app_otp?mobile=eq.${mobile}`, { method: 'PATCH', body: JSON.stringify({ code_hash: null }) });
      return res.status(200).json({ ok: true, token, name: name || (old && old.name) });
    }

    if (b.action === 'check') {
      const [u] = await sb(`app_users?mobile=eq.${mobile}&select=name,is_active,token_hash,open_count`);
      if (u && u.is_active === false) return res.status(200).json({ ok: false, reason: 'blocked' });
      if (!u || !b.token || u.token_hash !== sha(b.token)) return res.status(200).json({ ok: false, reason: 'register' });
      await sb(`app_users?mobile=eq.${enc(mobile)}`, { method: 'PATCH',
        body: JSON.stringify({ last_seen: new Date().toISOString(), open_count: (u.open_count || 0) + 1 }) });
      return res.status(200).json({ ok: true, name: u.name });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
};
