// api/cron-2h.js  (22-Oct-2026) – one 2-hourly job that keeps orders, invoices and Switchgear stock fresh.
//
// Why one job: the Vercel Hobby plan stopped deploying when vercel.json had 34 cron entries, so instead of
// adding more crons this endpoint re-uses the 12 two-hourly slots (previously /api/lvs-stock only).
// Each slot calls /api/cron-2h?h=HH (HH = IST hour) and this function starts, in parallel, as separate
// function calls (each gets its own time limit):
//   • /api/lvs-stock?save=1           every slot (stock sheet, round the clock)
//   • /api/sync-ob?days=N             IST 07:00 … 21:00 only  (N = 10 at 07:00 catch-up, else 2)
//   • /api/sync-invoice?days=N        same
// The old daily sync-ob / sync-invoice ?days=10 crons were removed, so two OB (or two INV) runs never
// overlap (overlapping runs of the same type could remove each other's freshly written lines).
// Weekly full OB / INV runs (Sat night) fall outside the 07–21 IST window, so they never overlap either.
// Never throws: the response lists what each call returned.
// 23-Oct-2026: the scheduled runs did not show up (only the 07:00 run was logged), while calling the same URL
// from the browser worked. Calls now always go to the production domain (never the per-deployment URL the
// cron request may carry, which can be behind Vercel login), the function gets 60 s (vercel.json "functions"),
// and every run is written to cron_2h_log (supabase/cron_2h_log.sql) so missed slots can be seen.

const OB_INV_FROM = 7, OB_INV_TO = 21;          // IST hours (inclusive) when orders / invoices are synced
const CALL_TIMEOUT_MS = 55000;
const PROD = process.env.PORTAL_URL || 'https://project-management-elmeasure.vercel.app';
const SUPA = 'https://xfdfbrfudsaxqgpsdboa.supabase.co/rest/v1';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGZicmZ1ZHNheHFncHNkYm9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTA1MzgsImV4cCI6MjA5NzM2NjUzOH0.sfUC5Mn_d7-FGkvQHyD01kdGM81TjG4VWzXoFv43n94';

async function logRun(entry) {
  try {
    await fetch(`${SUPA}/rpc/cron_2h_add`, { method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_entry: entry }) });
  } catch (e) { /* logging must never break the sync */ }
}

function istHour() { return new Date(Date.now() + 19800000).getUTCHours(); }

async function call(base, path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  const started = Date.now();
  try {
    const r = await fetch(base + path, { signal: ctrl.signal, headers: { 'user-agent': 'pm-portal-cron-2h' } });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    // keep the reply short: counts and errors only
    if (body && typeof body === 'object') {
      const keep = {};
      ['ok', 'fetched', 'upserted', 'deleted', 'skipped', 'saved', 'count', 'hasMore', 'resumeWith', 'error', 'saveError'].forEach(k => { if (body[k] !== undefined) keep[k] = body[k]; });
      body = keep;
    }
    return { path, status: r.status, ms: Date.now() - started, body };
  } catch (e) {
    // a timeout here only means this job stopped waiting; the called function keeps running on its own
    return { path, status: e.name === 'AbortError' ? 'still running (stopped waiting)' : 'error', ms: Date.now() - started, error: String(e.message || e).slice(0, 200) };
  } finally { clearTimeout(t); }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  const h = q.h != null && /^\d{1,2}$/.test(String(q.h)) ? parseInt(q.h, 10) : istHour();
  const base = PROD;
  const started = new Date().toISOString();
  const byCron = /vercel-cron/i.test(req.headers['user-agent'] || '');
  const jobs = ['/api/lvs-stock?save=1'];
  const obInv = q.obinv === '1' || (q.obinv !== '0' && h >= OB_INV_FROM && h <= OB_INV_TO);
  if (obInv) {
    const days = h === OB_INV_FROM ? 10 : 2;    // first run of the day catches up 10 days (replaces the old daily job)
    jobs.push(`/api/sync-ob?days=${days}`, `/api/sync-invoice?days=${days}`);
  }
  const results = await Promise.all(jobs.map(p => call(base, p)));
  const out = { istHour: h, obInvSynced: obInv, byCron, ranAt: started, results };
  await logRun({ h, by_cron: byCron, ob_inv: obInv, started_at: started, finished_at: new Date().toISOString(),
                 ok: results.every(r => r.status === 200), results });
  res.status(200).json(out);
};
