// lib/appAuth.js (24-Oct-2026) – shared helpers for the Elmeasure Insights app's mobile-OTP registration.
// Secrets come only from Vercel Environment Variables (never from this file):
//   SUPABASE_SERVICE_KEY  Supabase → Project Settings → API Keys → service_role / secret key
//   SMS_USER, SMS_PASS    smsjust.com login used to send the OTP SMS
//   CONTROL_PIN           PIN that opens the Control tab (list of app users)
const crypto = require('crypto');

const SUPA = 'https://xfdfbrfudsaxqgpsdboa.supabase.co/rest/v1';

function svcKey() {
  const k = process.env.SUPABASE_SERVICE_KEY;
  if (!k) throw new Error('Server not set up: add SUPABASE_SERVICE_KEY in Vercel → Settings → Environment Variables, then redeploy.');
  return k;
}

async function sb(path, opts = {}) {
  const k = svcKey();
  const headers = { apikey: k, 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (!/^sb_/.test(k)) headers.Authorization = `Bearer ${k}`;     // legacy JWT keys also need this header
  const r = await fetch(`${SUPA}/${path}`, { ...opts, headers });
  const t = await r.text();
  if (!r.ok) throw new Error(`Database ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const cleanMobile = m => { const d = String(m || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''); return /^[6-9]\d{9}$/.test(d) ? d : null; };
const cleanName = n => String(n || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

// DLT-approved template (sender ELMESR):
// "{#var#} is your OTP for {#var#} on {#var#}. It is valid for {#var#} minutes. Do not share it with anyone. Elmeasure"
async function sendSms(mobile, otp) {
  const user = process.env.SMS_USER, pass = process.env.SMS_PASS;
  if (!user || !pass) throw new Error('Server not set up: add SMS_USER and SMS_PASS in Vercel → Settings → Environment Variables, then redeploy.');
  const msg = `${otp} is your OTP for registration on Elmeasure Insights. It is valid for 10 minutes. Do not share it with anyone. Elmeasure`;
  const q = new URLSearchParams({
    username: user, pass, senderid: 'ELMESR', dest_mobileno: mobile, message: msg,
    dltentityid: '1601100000000000426', dlttempid: '1007007041741249822',
    tmid: '1602100000000004471', dltheaderid: '1605001593672494636', response: 'Y'
  });
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch('http://www.smsjust.com/blank/sms/user/urlsms.php?' + q.toString(), { signal: ctrl.signal });
    const text = (await r.text()).trim();
    if (!r.ok || /error|invalid|fail|denied|insufficient/i.test(text)) throw new Error('SMS gateway: ' + text.slice(0, 120));
    return text.slice(0, 80);
  } finally { clearTimeout(t); }
}

module.exports = { sb, sha, cleanMobile, cleanName, body, sendSms, crypto };
