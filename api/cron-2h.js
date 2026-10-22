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

const OB_INV_FROM = 7, OB_INV_TO = 21;          // IST hours (inclusive) when orders / invoices are synced
const CALL_TIMEOUT_MS = 58000;

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
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const base = `https://${host}`;
  const jobs = ['/api/lvs-stock?save=1'];
  const obInv = q.obinv === '1' || (q.obinv !== '0' && h >= OB_INV_FROM && h <= OB_INV_TO);
  if (obInv) {
    const days = h === OB_INV_FROM ? 10 : 2;    // first run of the day catches up 10 days (replaces the old daily job)
    jobs.push(`/api/sync-ob?days=${days}`, `/api/sync-invoice?days=${days}`);
  }
  const results = await Promise.all(jobs.map(p => call(base, p)));
  res.status(200).json({ istHour: h, obInvSynced: obInv, ranAt: new Date().toISOString(), results });
};
