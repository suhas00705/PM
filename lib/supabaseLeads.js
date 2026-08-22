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
    created_time: zohoLead.Created_Time || null
  };
}

// Upserts leads into Supabase in batches (Supabase/PostgREST handles large
// arrays fine, but we chunk to keep individual request payloads reasonable).
async function upsertLeads(zohoLeads) {
  const rows = zohoLeads.map(toRow);
  const BATCH_SIZE = 500;
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${LEADS_CACHE_URL}?on_conflict=id`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase upsert failed (batch ${i}): ${res.status} ${errText}`);
    }
    written += batch.length;
  }
  return written;
}

// Reads all cached leads back out, mapped to the same shape the frontend expects.
// allowedRegions: string[] — if non-empty, only returns leads in those regions.
// An empty array means no filter (all regions returned).
async function getCachedLeads(allowedRegions = []) {
  const REQUEST_SIZE = 1000;
  let allRows = [];
  let from = 0;
  let total = null;

  // Build region filter for PostgREST: region=in.("Delhi","Punjab")
  // Values are quoted and joined; empty array means no filter applied.
  const regionFilter = allowedRegions.length > 0
    ? `&region=in.(${allowedRegions.map(r => `"${r}"`).join(',')})`
    : '';

  while (true) {
    const to = from + REQUEST_SIZE - 1;
    const res = await fetch(
      `${LEADS_CACHE_URL}?select=*&order=created_time.desc,id.desc${regionFilter}`,
      { headers: { ...headers, Range: `${from}-${to}` } }
    );
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
  const idList = currentIds.map(id => `"${id}"`).join(',');
  await fetch(`${ENGINEERS_CACHE_URL}?id=not.in.(${idList})`, {
    method: 'DELETE',
    headers
  });
}

async function getCachedEngineers() {
  const REQUEST_SIZE = 1000;
  let allRows = [];
  let from = 0;
  let total = null;

  while (true) {
    const to = from + REQUEST_SIZE - 1;
    const res = await fetch(`${ENGINEERS_CACHE_URL}?select=*&order=full_name.asc`, {
      headers: { ...headers, Range: `${from}-${to}` }
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

module.exports = { upsertLeads, getCachedLeads, upsertEngineers, pruneEngineers, getCachedEngineers };
