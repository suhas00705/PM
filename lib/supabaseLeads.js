// Reuses the same Supabase project already used by the Friday Review tab.
const SUPABASE_URL = 'https://xfdfbrfudsaxqgpsdboa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGZicmZ1ZHNheHFncHNkYm9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTA1MzgsImV4cCI6MjA5NzM2NjUzOH0.sfUC5Mn_d7-FGkvQHyD01kdGM81TjG4VWzXoFv43n94';
const LEADS_CACHE_URL = `${SUPABASE_URL}/rest/v1/leads_cache`;

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json'
};

function toRow(zohoLead) {
  return {
    id: zohoLead.id,
    full_name: zohoLead.Full_Name || null,
    company: zohoLead.Company || null,
    account_name: zohoLead.Account_Name?.name || zohoLead.AccountName || null,
    owner_name: zohoLead.Owner?.name || zohoLead.OwnerName || null,
    lead_status: zohoLead.Lead_Status || null,
    order_value: zohoLead.Order_Value ?? null,
    region: zohoLead.Region || null,
    product_solution_type: zohoLead.Product_Solution_Type_Multi_Select || [],
    created_time: zohoLead.Created_Time || null,
    modified_time: zohoLead.Modified_Time || null,
    last_activity_time: zohoLead.Last_Activity_Time || null,
    lead_source: zohoLead.Lead_Source || null
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

async function upsertLeads(zohoLeads) {
  const rows = zohoLeads.map(toRow);
  const BATCH_SIZE = 500;
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const res = await postBatch(`${LEADS_CACHE_URL}?on_conflict=id`, batch);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase upsert failed (batch ${i}): ${res.status} ${errText}`);
    }
    written += batch.length;
  }
  return written;
}

// Reads cached leads, filtered by region if allowedRegions is non-empty.
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

// Only the columns the Leads pages use (falls back to all columns if the table ever lacks one).
const LEAD_COLS = 'id,full_name,company,account_name,owner_name,lead_status,order_value,region,product_solution_type,created_time';
async function getCachedLeads(allowedRegions = []) {
  return memo('leads|' + allowedRegions.join('|'), async () => {
    try { return await readLeads(allowedRegions, LEAD_COLS); }
    catch (e) { if (/\b400\b/.test(e.message)) return readLeads(allowedRegions, '*'); throw e; }
  });
}
async function readLeads(allowedRegions, selectCols) {
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

    const res = await fetch(`${LEADS_CACHE_URL}?${queryStr}`, {
      headers: { ...headers, Range: `${from}-${from + REQUEST_SIZE - 1}` }
    });
    if (!res.ok && res.status !== 206) {
      const errText = await res.text();
      throw new Error(`Supabase read failed: ${res.status} ${errText}`);
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
    Full_Name: r.full_name,
    Company: r.company,
    AccountName: r.account_name,
    OwnerName: r.owner_name,
    Lead_Status: r.lead_status,
    Order_Value: r.order_value,
    Region: r.region,
    Product_Solution_Type_Multi_Select: r.product_solution_type || [],
    Created_Time: r.created_time
  }));
}

const ENGINEERS_CACHE_URL = `${SUPABASE_URL}/rest/v1/engineers_cache`;

async function upsertEngineers(engineers) {
  const rows = engineers.map(e => ({ id: e.id, full_name: e.full_name, role: e.role }));
  if (!rows.length) return 0;
  const res = await fetch(`${ENGINEERS_CACHE_URL}?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase engineers upsert failed: ${res.status} ${errText}`);
  }
  return rows.length;
}

async function pruneEngineers(currentIds) {
  if (!currentIds.length) return;
  const idList = currentIds.join(',');
  await fetch(`${ENGINEERS_CACHE_URL}?id=not.in.(${idList})`, {
    method: 'DELETE',
    headers
  });
}

async function getCachedEngineers() { return memo('engineers', readEngineers); }
async function readEngineers() {
  const REQUEST_SIZE = 1000;
  let allRows = [];
  let from = 0;
  let total = null;

  while (true) {
    const res = await fetch(`${ENGINEERS_CACHE_URL}?select=*&order=full_name.asc`, {
      headers: { ...headers, Range: `${from}-${from + REQUEST_SIZE - 1}` }
    });
    if (!res.ok && res.status !== 206) {
      const errText = await res.text();
      throw new Error(`Supabase engineers read failed: ${res.status} ${errText}`);
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

  return allRows.map(r => r.full_name);
}

// 19-Oct-2026: leads converted to a potential, or deleted, in Zoho are removed from the cache,
// so the Leads dashboard shows the same open leads as Zoho (same pattern as deletePotentials).

// 19-Oct-2026: deletes go through the SECURITY DEFINER function cache_remove (supabase/cache_remove.sql),
// because the anon key may not DELETE directly (Supabase then silently removes 0 rows).
// Falls back to a plain DELETE if the function is not installed yet.
async function removeIds(table, tableUrl, ids) {
  let removed = 0;
  const clean = [...new Set(ids.map(String).filter(x => /^\d+$/.test(x)))];
  for (let i = 0; i < clean.length; i += 100) {
    const batch = clean.slice(i, i + 100);
    let res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cache_remove`, {
      method: 'POST', headers, body: JSON.stringify({ p_table: table, p_ids: batch })
    });
    if (res.ok) { const n = await res.json().catch(() => 0); removed += Number(n) || 0; continue; }
    if (res.status !== 404) throw new Error(`Supabase cache_remove failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    res = await fetch(`${tableUrl}?id=in.(${batch.join(',')})`, { method: 'DELETE', headers: { ...headers, Prefer: 'return=representation' } });
    if (!res.ok) throw new Error(`Supabase delete failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json().catch(() => []);
    removed += Array.isArray(rows) ? rows.length : 0;
  }
  return removed;
}

async function deleteLeads(ids) {
  const removed = await removeIds('leads_cache', LEADS_CACHE_URL, ids);
  if (removed) __mem.clear();
  return removed;
}

module.exports = { upsertLeads, getCachedLeads, upsertEngineers, pruneEngineers, getCachedEngineers, deleteLeads };
