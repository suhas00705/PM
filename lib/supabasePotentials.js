// Reuses the same Supabase project already used by Leads and Friday Review.
const SUPABASE_URL = 'https://xfdfbrfudsaxqgpsdboa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGZicmZ1ZHNheHFncHNkYm9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTA1MzgsImV4cCI6MjA5NzM2NjUzOH0.sfUC5Mn_d7-FGkvQHyD01kdGM81TjG4VWzXoFv43n94';
const POTENTIALS_CACHE_URL = `${SUPABASE_URL}/rest/v1/potentials_cache`;

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json'
};

function toRow(zohoPotential) {
  return {
    id: zohoPotential.id,
    deal_name: zohoPotential.Deal_Name || null,
    account_name: zohoPotential.Account_Name?.name || null,
    owner_name: zohoPotential.Owner?.name || null,
    region: zohoPotential.Region || null,
    amount: zohoPotential.Amount ?? null,
    probability: zohoPotential.Probability ?? null,
    stage: zohoPotential.Stage || null,
    // Closing date was never written before (8 Oct 2026 fix): new / re-dated deals had a blank
    // or stale closing date, so they were missing from the Closing Month tabs.
    closing_date: zohoPotential.Closing_Date || null,
    product_solution_type: zohoPotential.Product_Solution_Type_Multi_Select || [],
    created_time: zohoPotential.Created_Time || null,
    modified_time: zohoPotential.Modified_Time || null,
    last_activity_time: zohoPotential.Last_Activity_Time || null,
    lead_source: zohoPotential.Lead_Source || null
  };
}

// 16-Oct-2026: modified_time / last_activity_time / lead_source were added for the Path to Target lead analytics.
// If those columns are not in Supabase yet, write the row without them instead of failing the whole sync.
const NEW_COLS = ['modified_time', 'last_activity_time', 'lead_source'];
let __newColsMissing = false;
function stripNew(rows) { return rows.map(r => { const o = { ...r }; NEW_COLS.forEach(k => delete o[k]); return o; }); }
async function postBatch(url, batch) {
  const send = rows => fetch(url, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
  let res = await send(__newColsMissing ? stripNew(batch) : batch);
  if (!res.ok && !__newColsMissing) {
    const t = await res.text();
    if (res.status === 400 && NEW_COLS.some(c => t.includes(c))) { __newColsMissing = true; res = await send(stripNew(batch)); }
    else return { ok:false, status: res.status, text: async () => t };
  }
  return res;
}

// Upserts potentials into Supabase in batches, same pattern as leads.
async function upsertPotentials(zohoPotentials) {
  // Zoho paging can hand back the same deal twice (e.g. full mode); Postgres refuses a batch that
  // touches one id twice ("ON CONFLICT DO UPDATE command cannot affect row a second time"), so keep
  // only the last copy of each id.
  const byId = new Map();
  zohoPotentials.forEach(p => { if (p && p.id) byId.set(String(p.id), p); });
  const rows = [...byId.values()].map(toRow);
  const BATCH_SIZE = 500;
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const res = await postBatch(`${POTENTIALS_CACHE_URL}?on_conflict=id`, batch);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase potentials upsert failed (batch ${i}): ${res.status} ${errText}`);
    }
    written += batch.length;
  }
  return written;
}

// Reads cached potentials, filtered by region if allowedRegions is non-empty.
//
// FIX: Previously the filter used template-literal string concat like
//   `&region=in.("Karnataka")` which embeds raw double-quotes in the URL.
// Node.js 18+ fetch (WHATWG URL parser) percent-encodes " → %22, turning the
// query into region=in.(%22Karnataka%22). PostgREST may not decode those
// inner quotes and fails with 400, which bubbles up as 500.
// Using encodeURIComponent for the region value encodes spaces as %20 (not +),
// which PostgREST correctly decodes inside in.() values. Each region name is
// wrapped in double-quotes so PostgREST handles multi-word names and special
// characters like & in J&K.

// ── 10-minute in-memory copy (14-Oct-2026, saves Supabase egress) ──────────────
// A warm Vercel function re-uses this copy for repeat portal opens instead of re-reading every row.
// Concurrent requests share one read. Any error is never cached.
const __mem = new Map();
const MEM_TTL_MS = 10 * 60 * 1000;
function memo(key, loader) {
  const hit = __mem.get(key);
  if (hit && Date.now() - hit.at < MEM_TTL_MS) return hit.p;
  const p = loader().catch(err => { __mem.delete(key); throw err; });
  __mem.set(key, { at: Date.now(), p });
  return p;
}

// Only the columns the Potentials pages use (falls back to all columns, e.g. if qty does not exist).
const POT_COLS = 'id,deal_name,account_name,owner_name,region,amount,probability,stage,closing_date,qty,product_solution_type,created_time';
async function getCachedPotentials(allowedRegions = []) {
  return memo('pots|' + allowedRegions.join('|'), async () => {
    try { return await readPotentials(allowedRegions, POT_COLS); }
    catch (e) { if (/\b400\b/.test(e.message)) return readPotentials(allowedRegions, '*'); throw e; }
  });
}
async function readPotentials(allowedRegions, selectCols) {
  const REQUEST_SIZE = 1000;
  let allRows = [];
  let from = 0;
  let total = null;

  while (true) {
    const baseParams = new URLSearchParams({
      select: selectCols,
      order: 'created_time.desc,id.desc'
    });

    // Build the region filter manually with encodeURIComponent so spaces become
    // %20 (not +). URLSearchParams.append uses application/x-www-form-urlencoded
    // which encodes spaces as +, but PostgREST only decodes %20 as space inside
    // in.() values, causing multi-word regions like "Himachal Pradesh" to not match.
    // Each region is double-quoted so PostgREST handles spaces and & in names.
    let queryStr = baseParams.toString();
    if (allowedRegions.length > 0) {
      const regionVal = `in.(${allowedRegions.map(r => `"${r}"`).join(',')})`;
      queryStr += `&region=${encodeURIComponent(regionVal)}`;
    }

    const to = from + REQUEST_SIZE - 1;
    const res = await fetch(`${POTENTIALS_CACHE_URL}?${queryStr}`, {
      headers: { ...headers, Range: `${from}-${to}` }
    });
    if (!res.ok && res.status !== 206) {
      const errText = await res.text();
      throw new Error(`Supabase potentials read failed: ${res.status} ${errText}`);
    }
    const rows = await res.json();
    if (!rows.length) break;
    allRows = allRows.concat(rows);

    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      const [, totalStr] = contentRange.split('/');
      if (totalStr && totalStr !== '*') total = parseInt(totalStr, 10);
    }
    from += rows.length;
    if (total !== null && from >= total) break;
    if (total === null && rows.length < REQUEST_SIZE) break;
  }

  return allRows.map(r => ({
    id: r.id,
    Deal_Name: r.deal_name,
    AccountName: r.account_name,
    OwnerName: r.owner_name,
    Region: r.region,
    Amount: r.amount,
    Probability: r.probability,
    Stage: r.stage,
    Closing_Date: r.closing_date,
    Qty: r.qty,
    Product_Solution_Type_Multi_Select: r.product_solution_type || [],
    Created_Time: r.created_time
  }));
}

// Removes deals that were deleted in Zoho, so they stop showing on the dashboards.
async function deletePotentials(ids) {
  let removed = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const res = await fetch(`${POTENTIALS_CACHE_URL}?id=in.(${batch.join(',')})`, {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=representation' }
    });
    if (!res.ok) throw new Error(`Supabase potentials delete failed: ${res.status} ${await res.text()}`);
    const rows = await res.json().catch(() => []);
    removed += Array.isArray(rows) ? rows.length : 0;
  }
  return removed;
}

module.exports = { upsertPotentials, getCachedPotentials, deletePotentials };
