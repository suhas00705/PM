// lib/pushAlerts.js (30-Oct-2026) – phone notifications for the Elmeasure Insights app.
//   • a REGION reaches 100% of its plain monthly order-booking plan (Region Tracking targets)  → opens Region Tracking
//   • a PRODUCT (PM Cumulative rows) reaches 100% of its plain monthly OB plan                   → opens PM Cumulative, current month
// Plain plan = FY target × quarter share (Q1 20%, Q2 25%, Q3 25%, Q4 30%) ÷ 3 – no carried shortfall (user, 30-Oct-2026).
// Each region / product alerts once per month (table push_sent). Sent to approved, signed-in app users who can see
// that tab (Region Tracking / PM Cumulative); the app admin gets all.
// Run by /api/cron-2h (07–21 IST slots) → GET /api/app-otp?action=push_check&k=…  (k = checkKey()).
// Secrets only from Vercel env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_SERVICE_KEY.
const webpush = require('web-push');
const { sb, sha } = require('./appAuth');

const ADMIN_MOBILE = '6366908219';
const APP_TABS = ['leads','potentials','cpanalytics','pmtracking','oemtracking','salestracking','pathtarget','regiontrack','lvs'];
const QSHARE = [0.20, 0.25, 0.25, 0.30];
const TARGET_FY = 2026;
// ---- same as region-tracking.html ----
const REGIONS = {
  'OEM':10000, 'Hyderabad':6600, 'Karnataka':5000, 'Delhi NCR':3500, 'Mumbai':2660, 'Gujarat':2200, 'Chennai':2100, 'Pune':2100,
  'Export':2000, 'Data Centre':2000, 'Vijayawada':1700, 'Madurai & Salem':1300, 'Coimbatore':1200, 'Punjab':1080, 'East India':1050,
  'Eastern UP':710, 'Nagpur & CG':700, 'North Kerala':600, 'MP':550, 'Rajasthan':360, 'South Kerala':300, 'Govt Projects':300, 'Goa':240,
  'Other regions':3750
};
const GMS = { 'Nitin Agarwal':['Hyderabad','Vijayawada','Vizag','East India'], 'Anwar':['Delhi NCR','MP','Eastern UP','Punjab','Rajasthan'],
  'Joseph':['Chennai','Coimbatore','Madurai & Salem','North Kerala','South Kerala'], 'Vaibhav':['Mumbai','Pune','Goa'],
  'Vivek':['Gujarat','Nagpur & CG'], 'Vinod Kumar':['Karnataka'], 'Dileep A K':['Data Centre'], 'Sam J':['Export'] };
const gmOf = r => Object.keys(GMS).find(g => GMS[g].includes(r)) || null;
// ---- same as pm-tracking.html ----
const PRODUCTS = [
  { name:'Panel Meters',  pm:'Manikanda S', baskets:['Panel Meters','High End MFM','Nano VIP','Power Quality'], target:8960 },
  { name:'ACCL',          pm:'Gurubaran N', baskets:['ACCL'], target:2680 },
  { name:'ATES',          pm:'Gurubaran N', baskets:['Transfer Switch'], target:9550 },
  { name:'Prepaid/Smart', pm:'Suhas G',     baskets:['Prepaid & Smart Meters','Prepaid','Smart Meters'], exclGovt:true, target:5150 },
  { name:'LVS',           pm:'Nirmal B',    baskets:['SWITCHGEAR'], target:7610 },
  { name:'FDP',           pm:'Nirmal B',    baskets:['FDP'], target:3000 },
  { name:'OEM',           pm:'Krishna KN',  baskets:['OEM'], target:10000 }
];
const MN = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MFULL = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

const qIdx = m => m >= 4 && m <= 6 ? 0 : m >= 7 && m <= 9 ? 1 : m >= 10 ? 2 : 3;
const plan = (T, m) => T * QSHARE[qIdx(m)] / 3;
const fL = v => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1));
const pct = (a, t) => (a / t * 100).toFixed(1) + '%';
function nowIst() { const d = new Date(Date.now() + 19800000); const m = d.getUTCMonth() + 1, y = d.getUTCFullYear(); return { m, cy: m >= 4 ? y : y - 1 }; }
const dd = s => { if (!s) return ''; const d = new Date(s); return d.getDate() + ' ' + MN[d.getMonth() + 1]; };

function checkKey() { return sha('push|' + (process.env.SUPABASE_SERVICE_KEY || '')).slice(0, 24); }
function vapidReady() {
  const pub = process.env.VAPID_PUBLIC_KEY, pri = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !pri) return false;
  webpush.setVapidDetails('mailto:suhas.s@elmeasure.com', pub, pri);
  return true;
}

/* ---------- what reached 100% this month ---------- */
async function findEvents() {
  const { m, cy } = nowIst();
  if (cy !== TARGET_FY) return { m, cy, events: [], note: 'no targets for this FY' };
  const [cube, pmt] = await Promise.all([
    sb('rpc/ptt_cube', { method: 'POST', body: JSON.stringify({ p_cy: cy }) }),
    sb('rpc/pm_tracking', { method: 'POST', body: JSON.stringify({ p_fy: cy }) })
  ]);
  const rg = cube.rg || [], bk = cube.bk || [], asof = dd(cube.max_ob);
  // cube row: [doc 0 OB / 1 INV, year 0 this FY, month, region#, type#, product#, basket#, value ₹L, lfl ₹L]
  const R = {}, RB = {}, BR = {};
  (cube.rows || []).forEach(a => {
    if (a[0] || a[1] || a[2] !== m) return;
    const r = rg[a[3]], b = String(bk[a[6]] || '').replace(/\s+/g, ' '), v = +a[7] || 0;
    R[r] = (R[r] || 0) + v;
    (RB[r] = RB[r] || {})[b] = (RB[r][b] || 0) + v;
    (BR[b] = BR[b] || {})[r] = (BR[b][r] || 0) + v;
  });
  const NICE = { 'Transfer Switch':'ATES', 'SWITCHGEAR':'LVS (Switchgear)', 'Prepaid & Smart Meters':'Prepaid/Smart' };
  const top = o => { const e = Object.entries(o || {}).sort((x, y) => y[1] - x[1])[0]; return e && e[1] > 0 ? e : null; };
  const events = [];
  Object.entries(REGIONS).forEach(([r, T]) => {
    const t = plan(T, m), a = R[r] || 0;
    if (t > 0 && a >= t) {
      const tb = top(RB[r]), gm = gmOf(r);
      events.push({ kind: 'R', key: `R|${cy}-${m}|${r}`, name: r, a, t, tab: 'regiontrack',
        title: `🎯 ${r} hit ${pct(a, t)} of ${MFULL[m]} target`,
        body: `₹${fL(a)} L booked vs ₹${fL(t)} L target (+₹${fL(a - t)} L)` +
              `\n${gm ? 'GM ' + gm + ' · ' : ''}${tb ? 'Top basket ' + (NICE[tb[0]] || tb[0]) + ' ₹' + fL(tb[1]) + ' L' : ''}` +
              `\nOrder booking till ${asof} · Tap to open Region Tracking`,
        url: '/?app=1&tab=regiontrack' });
    }
  });
  // PM Cumulative products (rupees; Govt Projects left out for Prepaid/Smart)
  const PB = {};
  (pmt.rows || []).forEach(x => { if (x.d !== 'OB' || +x.m !== m) return;
    const o = (PB[x.b] = PB[x.b] || { v: 0, g: 0 }); if (x.gov) o.g += +x.v || 0; else o.v += +x.v || 0; });
  PRODUCTS.forEach(p => {
    const a = p.baskets.reduce((s, b) => s + (PB[b] ? PB[b].v + (p.exclGovt ? 0 : PB[b].g) : 0), 0) / 1e5, t = plan(p.target, m);
    if (t > 0 && a >= t) {
      const reg = {}; p.baskets.forEach(b => Object.entries(BR[b] || {}).forEach(([r, v]) => reg[r] = (reg[r] || 0) + v));
      const tr = top(reg);
      events.push({ kind: 'P', key: `P|${cy}-${m}|${p.name}`, name: p.name, a, t, tab: 'pmtracking',
        title: `🏆 ${p.name} hit ${pct(a, t)} of ${MFULL[m]} target`,
        body: `₹${fL(a)} L booked vs ₹${fL(t)} L target (+₹${fL(a - t)} L)` +
              `\nPM ${p.pm}${tr ? ' · Top region ' + tr[0] + ' ₹' + fL(tr[1]) + ' L' : ''}` +
              `\nOrder booking till ${dd(pmt.max_date_ob) || asof} · Tap to open PM Cumulative`,
        url: '/?app=1&tab=pmtracking&pm=cur' });
    }
  });
  return { m, cy, events };
}

/* ---------- who gets it ---------- */
async function recipients() {
  const users = await sb('app_users?select=*&is_active=eq.true');
  const subs = await sb('app_push?select=*');
  const byMobile = {};
  users.forEach(u => {
    if (!u.token_hash) return;                                           // logged out
    if (u.status === 'pending' && u.mobile !== ADMIN_MOBILE) return;      // not approved yet
    const t = (Array.isArray(u.allowed_tabs) ? u.allowed_tabs : []).filter(x => APP_TABS.includes(x));
    byMobile[u.mobile] = { tabs: u.mobile === ADMIN_MOBILE ? APP_TABS : (t.length ? t : APP_TABS), subs: [] };
  });
  subs.forEach(s => { if (byMobile[s.mobile]) byMobile[s.mobile].subs.push(s); });
  return byMobile;
}

async function sendTo(sub, payload) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'normal' });
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {                // phone unsubscribed / app removed
      await sb(`app_push?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }).catch(() => {});
    }
    return false;
  }
}

/* ---------- the check (cron) ---------- */
async function runChecks({ dry } = {}) {
  if (!vapidReady()) return { ok: false, error: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set in Vercel' };
  const { m, events, note } = await findEvents();
  if (!events.length) return { ok: true, events: 0, sent: 0, note };
  // claim the events not alerted yet (insert ... on conflict do nothing → only the new ones come back)
  const fresh = dry ? events : await sb('push_sent?on_conflict=k', { method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(events.map(e => ({ k: e.key, info: { a: +e.a.toFixed(2), t: +e.t.toFixed(2) } }))) });
  const newKeys = new Set((fresh || []).map(x => x.k || x.key));
  const todo = events.filter(e => newKeys.has(e.key));
  if (!todo.length) return { ok: true, events: events.length, new: 0, sent: 0 };
  const people = await recipients();
  let sent = 0, phones = 0;
  for (const [mobile, p] of Object.entries(people)) {
    if (!p.subs.length) continue;
    const mine = todo.filter(e => p.tabs.includes(e.tab));
    if (!mine.length) continue;
    const msgs = [];
    ['R', 'P'].forEach(kind => {
      const list = mine.filter(e => e.kind === kind).sort((a, b) => b.a / b.t - a.a / a.t);
      if (!list.length) return;
      if (list.length <= 2) list.forEach(e => msgs.push({ title: e.title, body: e.body, url: e.url, tag: e.key }));
      else msgs.push({                                                   // several at once → one summary
        title: kind === 'R' ? `🎯 ${list.length} regions hit their ${MFULL[m]} target` : `🏆 ${list.length} products hit their ${MFULL[m]} target`,
        body: list.slice(0, 6).map(e => `${e.name} ${pct(e.a, e.t)} (₹${fL(e.a)} L of ₹${fL(e.t)} L)`).join('\n') +
              (list.length > 6 ? `\n+${list.length - 6} more` : '') + `\nTap to open ${kind === 'R' ? 'Region Tracking' : 'PM Cumulative'}`,
        url: list[0].url, tag: `${kind}|sum|${m}|${Date.now()}` });
    });
    let any = false;
    for (const s of p.subs) for (const msg of msgs) if (await sendTo(s, msg)) { sent++; any = true; }
    if (any) phones++;
  }
  return { ok: true, events: events.length, new: todo.length, alerts: todo.map(e => e.name), phones, sent };
}

/* ---------- this phone: subscribe + confirmation ---------- */
async function saveSub(mobile, sub) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Bad subscription');
  await sb('app_push?on_conflict=endpoint', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ endpoint: sub.endpoint, mobile, p256dh: sub.keys.p256dh, auth: sub.keys.auth, created_at: new Date().toISOString() }) });
  if (vapidReady()) await sendTo({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    { title: '🔔 Target alerts are on', body: 'You will get a notification when a region or product reaches 100% of its monthly target.', url: '/?app=1', tag: 'welcome' });
}
async function dropSub(endpoint) { if (endpoint) await sb(`app_push?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' }); }

module.exports = { runChecks, findEvents, saveSub, dropSub, checkKey, vapidReady };
