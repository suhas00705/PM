// One-time loader: pushes the Excel history (OB + Invoice up to 28-Sep-2026) into Supabase.
//
// Usage (Windows CMD, from the PMportalready folder):
//     node data-import\load-sales-history.js
//
// Safe to run more than once — rows are keyed (XL-OB-000001 …) so a re-run only overwrites.
// Needs Node 18 or newer. No npm install required.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xfdfbrfudsaxqgpsdboa.supabase.co';
const KEY = process.argv[2] || process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGZicmZ1ZHNheHFncHNkYm9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTA1MzgsImV4cCI6MjA5NzM2NjUzOH0.sfUC5Mn_d7-FGkvQHyD01kdGM81TjG4VWzXoFv43n94';
const FILES = ['ob_history.csv.gz', 'invoice_history.csv.gz'];
const BATCH = 1000;
const NUMERIC = new Set(['row_no', 'doc_num', 'quantity', 'price', 'disc_prcnt', 'list_price', 'doc_total',
  'line_total', 'tax_calc', 'freight_charges', 'doc_total_fc']);

if (!KEY) {
  console.error('\nMissing key.  Run:  node data-import\\load-sales-history.js YOUR_SERVICE_ROLE_KEY\n' +
                '(Supabase → Project Settings → API → service_role "secret")\n');
  process.exit(1);
}

// Minimal RFC-4180 CSV parser (handles quotes, commas and "" inside fields)
function* parseCsv(text) {
  let row = [], field = '', i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); yield row; row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); yield row; }
}

async function post(rows, attempt = 1) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sales_lines?on_conflict=line_key`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
               Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
  if (res.ok) return;
  const t = await res.text();
  if (attempt < 4 && (res.status >= 500 || res.status === 429)) {
    await new Promise(r => setTimeout(r, 2000 * attempt));
    return post(rows, attempt + 1);
  }
  throw new Error(`Supabase ${res.status}: ${t.slice(0, 500)}`);
}

async function count(docType) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sales_lines?select=id&source=eq.excel&doc_type=eq.${docType}`, {
    method: 'HEAD', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' }
  });
  return (res.headers.get('content-range') || '').split('/')[1];
}

(async () => {
  for (const file of FILES) {
    const full = path.join(__dirname, file);
    const text = zlib.gunzipSync(fs.readFileSync(full)).toString('utf8');
    const it = parseCsv(text);
    const header = it.next().value;
    let batch = [], sent = 0;
    const t0 = Date.now();
    for (const cells of it) {
      if (cells.length === 1 && cells[0] === '') continue;
      const rec = {};
      header.forEach((h, i) => {
        const v = cells[i];
        rec[h] = (v === undefined || v === '') ? null : (NUMERIC.has(h) ? Number(v) : v);
      });
      batch.push(rec);
      if (batch.length === BATCH) { await post(batch); sent += batch.length; batch = [];
        process.stdout.write(`\r${file}: ${sent.toLocaleString()} rows sent…`); }
    }
    if (batch.length) { await post(batch); sent += batch.length; }
    console.log(`\r${file}: ${sent.toLocaleString()} rows sent in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  console.log(`\nIn Supabase now → OB (Excel): ${await count('OB')} rows,  Invoice (Excel): ${await count('INV')} rows`);
  console.log('Expected      → OB (Excel): 67935 rows,  Invoice (Excel): 70271 rows\n');
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
