// lib/portalSession.js (26-Oct-2026) – 7-day sign-in token of the desktop portal (Google sign-in).
// Used by /api/user-permissions (issues it) and lib/appUsers.js (admin opens Control → App users without the PIN).
const crypto = require('crypto');
const ADMIN_EMAIL = 'suhas.s@elmeasure.com';
const DAYS = 7;
function secret() { return process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY || ''; }
function sign(email) {
  const p = Buffer.from(JSON.stringify({ e: email, x: Date.now() + DAYS * 864e5 })).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', secret()).update(p).digest('base64url');
}
function readToken(t) {
  const [p, s] = String(t || '').split('.');
  if (!p || !s || !secret()) return null;
  const good = crypto.createHmac('sha256', secret()).update(p).digest('base64url');
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try { const j = JSON.parse(Buffer.from(p, 'base64url').toString()); return j.x > Date.now() ? String(j.e).toLowerCase() : null; } catch (e) { return null; }
}
module.exports = { sign, readToken, ADMIN_EMAIL };
