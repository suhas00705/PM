// api/lvs-stock.js  (19-Oct-2026)
// Live Switchgear stock for the LVS tab, read from the Google Sheet "Elmeasure Live Stock Report_NEW",
// sheet "SwitchGear" (gid 0). The sheet must be shared "Anyone with the link – Viewer"
// (or set env LVS_STOCK_CSV_URL to a "Publish to web" CSV link instead).
// Columns are found by their header names, so moving columns in the sheet does not break it.
// 19-Oct-2026: the sheet updates every 2 hours, so a Vercel cron calls ?save=1 every 2 hours and the
// copy is kept in Supabase (lvs_stock_snap, supabase/lvs_stock.sql). The page reads that copy;
// ?fresh=1 (the page's Refresh button) reads the sheet now and saves it. If the saved copy is
// missing, the sheet is read live.
const SHEET_ID = '1iNVCc8v8cun1Enq5jOUppfnBGahb7cEE6vNCxg1rL5g';
const GID = '0';
const CSV_URL = process.env.LVS_STOCK_CSV_URL ||
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
const SUPA = 'https://xfdfbrfudsaxqgpsdboa.supabase.co/rest/v1';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGZicmZ1ZHNheHFncHNkYm9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTA1MzgsImV4cCI6MjA5NzM2NjUzOH0.sfUC5Mn_d7-FGkvQHyD01kdGM81TjG4VWzXoFv43n94';
async function rpc(fn, body) {
  const r = await fetch(`${SUPA}/rpc/${fn}`, { method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '').trim()); return isFinite(n) ? n : 0; };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function toItems(rows) {
  const hi = rows.findIndex(r => r.some(c => norm(c) === 'catcode') && r.some(c => norm(c) === 'code'));
  if (hi < 0) throw new Error('Header row with "CatCode" and "Code" not found in the sheet');
  const h = rows[hi].map(norm);
  const col = (...names) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const C = {
    cat: col('catcode'), code: col('code'), model: col('modelname'), name: col('itemname'),
    fg: col('fgstock'), swg: col('stockasonselectedswg'), iqc: col('stockasonselectediqc'),
    total: col('totalstock'), open: col('totalopenorderqty'),
    d1: col('deliveryin1week'), d4: col('deliveryin4weeks'), d8: col('deliveryin8weeks')
  };
  if (C.code < 0 || C.total < 0) throw new Error('Columns "Code" / "Total Stock" not found in the sheet');
  const g = (r, i) => (i >= 0 ? r[i] : '');
  return rows.slice(hi + 1)
    .filter(r => String(g(r, C.code)).trim() || String(g(r, C.cat)).trim())
    .map(r => ({
      code: String(g(r, C.code)).trim(), cat: String(g(r, C.cat)).trim(),
      model: String(g(r, C.model)).trim(), name: String(g(r, C.name)).trim(),
      fg: num(g(r, C.fg)), swg: num(g(r, C.swg)), iqc: num(g(r, C.iqc)), total: num(g(r, C.total)),
      open: num(g(r, C.open)), d1: num(g(r, C.d1)), d4: num(g(r, C.d4)), d8: num(g(r, C.d8))
    }));
}

async function readSheet() {
  const r = await fetch(CSV_URL, { redirect: 'follow' });
  const text = await r.text();
  if (!r.ok) throw new Error(`Google Sheet returned ${r.status}`);
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error('The stock sheet cannot be read. In Google Sheets: Share → General access → "Anyone with the link" → Viewer, and allow viewers to download.');
  }
  return toItems(parseCsv(text));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  try {
    if (!q.save && !q.fresh) {
      // normal page load: the copy saved by the 2-hourly job
      try {
        const snap = await rpc('lvs_stock_get');
        if (snap && Array.isArray(snap.items) && snap.items.length) {
          return res.status(200).json({ fetchedAt: snap.fetchedAt, count: snap.items.length, items: snap.items, source: 'saved' });
        }
      } catch (e) { /* table / function not there yet: read the sheet live */ }
    }
    const items = await readSheet();
    let saved = false, saveError;
    try { await rpc('lvs_stock_save', { p_items: items }); saved = true; } catch (e) { saveError = e.message; }
    if (q.save) return res.status(200).json({ saved, count: items.length, savedAt: new Date().toISOString(), ...(saveError ? { saveError } : {}) });
    return res.status(200).json({ fetchedAt: new Date().toISOString(), count: items.length, items, source: 'live', ...(saveError ? { saveError } : {}) });
  } catch (err) {
    // sheet unreadable: fall back to the last saved copy, marked stale
    try {
      const snap = await rpc('lvs_stock_get');
      if (snap && Array.isArray(snap.items) && snap.items.length) {
        return res.status(200).json({ fetchedAt: snap.fetchedAt, count: snap.items.length, items: snap.items, source: 'saved', stale: true, error: err.message });
      }
    } catch (e) { /* ignore */ }
    return res.status(502).json({ error: err.message });
  }
};
