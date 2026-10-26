// api/user-permissions.js (26-Oct-2026) – Google sign-in for the desktop PM portal + user list for the Control tab.
// Everything is POST {action, ...}. The Google sign-in is checked on the server, so nobody can fake an email.
//   {action:'login',   credential}            → Google ID token → {ok, token, ...perms} | {pending} | {blocked}
//   {action:'session', token}                 → re-check a saved 7-day sign-in (picks up blocks / tab changes at once)
//   {action:'list',    token}                 → all portal users          (admin only)
//   {action:'save',    token, email, ...}     → add / approve / edit / block (admin only)
//   {action:'delete',  token, email}          → remove a user             (admin only)
// The mobile app (Elmeasure Insights) does NOT use this – it keeps its SMS OTP login (/api/app-otp).
// Secrets only from Vercel env vars: SUPABASE_SERVICE_KEY (already set). Optional SESSION_SECRET.
const { sb, body, crypto } = require('../lib/appAuth');

const ADMIN_EMAIL = 'suhas.s@elmeasure.com';
const CLIENT_ID   = '907018546073-cgdqmgd5ubs2o0aig3ioqh28qb2r5rhc.apps.googleusercontent.com';
const DOMAIN      = '@elmeasure.com';
const DAYS        = 7;
const TABS        = ['leads','potentials','cpanalytics','pmtracking','oemtracking','salestracking','pathtarget','regiontrack','lvs','createleads'];
const ADMIN_TABS  = [...TABS.slice(0, 9), 'control', 'createleads'];
const enc = encodeURIComponent;

function secret() { return process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY || ''; }
const b64u = s => Buffer.from(s).toString('base64url');
function sign(email) {
  const p = b64u(JSON.stringify({ e: email, x: Date.now() + DAYS * 864e5 }));
  return p + '.' + crypto.createHmac('sha256', secret()).update(p).digest('base64url');
}
function readToken(t) {
  const [p, s] = String(t || '').split('.');
  if (!p || !s || !secret()) return null;
  const good = crypto.createHmac('sha256', secret()).update(p).digest('base64url');
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try { const j = JSON.parse(Buffer.from(p, 'base64url').toString()); return j.x > Date.now() ? String(j.e).toLowerCase() : null; } catch (e) { return null; }
}

async function verifyGoogle(credential) {
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + enc(String(credential || '')));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.aud !== CLIENT_ID) throw Object.assign(new Error('Google sign-in could not be verified. Try again.'), { code: 401 });
  if (!/^(https:\/\/)?accounts\.google\.com$/.test(j.iss || '')) throw Object.assign(new Error('Google sign-in could not be verified.'), { code: 401 });
  if (String(j.email_verified) !== 'true') throw Object.assign(new Error('Your Google email is not verified.'), { code: 401 });
  return { email: String(j.email || '').toLowerCase(), name: j.name || '', picture: j.picture || '' };
}

const arr = v => Array.isArray(v) ? v : (typeof v === 'string' && v ? (() => { try { return JSON.parse(v); } catch (e) { return v.replace(/[{}"]/g, '').split(',').filter(Boolean); } })() : []);
async function getUser(email) { const [u] = await sb(`user_permissions?email=eq.${enc(email)}&select=*`); return u || null; }
function perms(u, email) {
  const admin = email === ADMIN_EMAIL;
  return { ok: true, email, name: (u && u.name) || email, picture: (u && u.picture) || '', is_admin: admin,
           allowed_tabs: admin ? ADMIN_TABS : arr(u && u.allowed_tabs).filter(t => TABS.includes(t)),
           allowed_regions: admin ? [] : arr(u && u.allowed_regions) };
}
function state(u, email) {
  if (email === ADMIN_EMAIL) return 'ok';
  if (!u) return 'none';
  if (u.is_active === false) return 'blocked';
  if (u.status === 'pending') return 'pending';
  return 'ok';
}
const MSG = { blocked: 'Your access has been blocked. Contact suhas.s@elmeasure.com.',
              pending: 'Your request is waiting for approval by the admin (suhas.s@elmeasure.com).',
              none:    'Your account is not on the list. Sign in again to send an access request.' };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const b = body(req);
  try {
    if (b.action === 'login') {
      const g = await verifyGoogle(b.credential);
      if (!g.email.endsWith(DOMAIN)) return res.status(403).json({ error: 'Only @elmeasure.com Google accounts can sign in.' });
      let u = await getUser(g.email);
      const now = new Date().toISOString();
      if (!u) {
        const row = { email: g.email, name: g.name, picture: g.picture, last_login: now, login_count: 1,
                      status: g.email === ADMIN_EMAIL ? 'approved' : 'pending', requested_at: now, is_active: true,
                      allowed_tabs: [], allowed_regions: [] };
        [u] = await sb('user_permissions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
      } else {
        await sb(`user_permissions?email=eq.${enc(g.email)}`, { method: 'PATCH',
          body: JSON.stringify({ name: g.name || u.name, picture: g.picture || u.picture, last_login: now, login_count: (u.login_count || 0) + 1 }) });
        u = { ...u, name: g.name || u.name, picture: g.picture || u.picture };
      }
      const st = state(u, g.email);
      if (st === 'blocked') return res.status(403).json({ blocked: true, error: MSG.blocked });
      if (st === 'pending') return res.status(202).json({ pending: true, email: g.email, name: u.name, message: MSG.pending });
      return res.status(200).json({ ...perms(u, g.email), token: sign(g.email) });
    }

    const me = readToken(b.token);
    if (!me) return res.status(401).json({ error: 'Please sign in again.' });

    if (b.action === 'session') {
      const u = await getUser(me), st = state(u, me);
      if (st !== 'ok') return res.status(st === 'blocked' ? 403 : 401).json({ error: MSG[st], [st]: true });
      return res.status(200).json(perms(u, me));
    }

    if (me !== ADMIN_EMAIL) return res.status(403).json({ error: 'Only the admin can manage users.' });

    if (b.action === 'list') {
      const users = await sb('user_permissions?select=*');
      return res.status(200).json({ ok: true, admin: ADMIN_EMAIL, tabs: TABS,
        users: (users || []).map(u => ({ ...u, allowed_tabs: arr(u.allowed_tabs), allowed_regions: arr(u.allowed_regions) })) });
    }

    const email = String(b.email || '').trim().toLowerCase();
    if (!email.endsWith(DOMAIN) || !/^[^\s@]+@elmeasure\.com$/.test(email)) return res.status(400).json({ error: 'Enter a valid @elmeasure.com email.' });
    if (email === ADMIN_EMAIL) return res.status(400).json({ error: 'The admin account always has full access.' });

    if (b.action === 'save') {
      const row = { email };
      if (Array.isArray(b.allowed_tabs))    row.allowed_tabs    = b.allowed_tabs.filter(t => TABS.includes(t));
      if (Array.isArray(b.allowed_regions)) row.allowed_regions = b.allowed_regions.map(String).slice(0, 200);
      if (typeof b.is_active === 'boolean') row.is_active = b.is_active;
      if (b.status === 'approved' || b.status === 'pending') row.status = b.status;
      if (typeof b.name === 'string' && b.name.trim()) row.name = b.name.replace(/[<>]/g, '').trim().slice(0, 80);
      const old = await getUser(email);
      if (!old) { row.status = row.status || 'approved'; row.is_active = row.is_active !== false; row.requested_at = new Date().toISOString();
                  row.allowed_tabs = row.allowed_tabs || []; row.allowed_regions = row.allowed_regions || []; }
      await sb('user_permissions?on_conflict=email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'delete') {
      await sb(`user_permissions?email=eq.${enc(email)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(e.code || 500).json({ error: String(e.message || e).slice(0, 300) });
  }
};
