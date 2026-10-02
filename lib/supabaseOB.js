const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const TABLE = 'ob_cache';

/**
 * Map a Zoho Analytics OB row (column array + header array) to a Supabase record.
 * Zoho Analytics returns { columns: [...], rows: [[...], ...] }
 */
function mapRow(cols, row) {
  const r = {};
  cols.forEach((c, i) => { r[c] = row[i]; });

  const parseDate = (v) => {
    if (!v) return null;
    // Zoho Analytics returns dates as strings: "04-Apr-2025" or "2025-04-04"
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    // "04-Apr-2025" format
    const m = v.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})/);
    if (m) {
      const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                       Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
      return `${m[3]}-${months[m[2]]}-${m[1]}`;
    }
    return null;
  };

  return {
    row_id:           parseInt(r['#']) || null,
    company:          r['Company'] || null,
    doc_num:          parseInt(r['DocNum']) || null,
    posting_date:     parseDate(r['Posting Date']),
    doc_date:         parseDate(r['DocDate']),
    card_name:        r['CardName'] || null,
    card_code:        r['CardCode'] || null,
    num_at_card:      r['NumAtCard'] || null,
    u_internal:       r['U_INTERNAL'] || null,
    account_type:     r['U_Accounttype'] || null,
    product_category: r['U_ProductCategory'] || null,
    product_type:     r['Product Type'] || null,
    product_basket:   r['Product Basket'] || null,
    product_series:   r['Product Series'] || null,
    item_code:        parseInt(r['ItemCode']) || null,
    cat_code:         r['Cat Code'] || null,
    description:      r['Dscription'] || null,
    model_id:         r['U_ModelId'] || null,
    quantity:         parseFloat(r['Quantity']) || null,
    price:            parseFloat(r['Price']) || null,
    disc_prcnt:       parseFloat(r['DiscPrcnt']) || null,
    list_price:       parseFloat(r['List Price']) || null,
    doc_total:        parseFloat(r['DocTotal']) || null,
    line_total:       parseFloat(r['Line Total']) || null,
    tax_calc:         parseFloat(r['Tax calc']) || null,
    freight_charges:  parseFloat(r['Frieght/Packing Charges']) || null,
    doc_total_fc:     parseFloat(r['DocTotalFC']) || null,
    region:           r['U_region'] || null,
    slp_name:         r['SlpName'] || null,
    se_reg:           r['U_SEReg'] || null,
    synced_at:        new Date().toISOString(),
  };
}

/**
 * Upsert an array of { columns, rows } responses from Zoho Analytics into ob_cache.
 * Returns the number of rows written.
 */
async function upsertOB(columns, rows) {
  if (!rows || rows.length === 0) return 0;

  const records = rows
    .map(row => mapRow(columns, row))
    .filter(r => r.row_id !== null && r.company !== null);

  const BATCH = 500;
  let written = 0;

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=company%2Crow_id`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(batch),
      }
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Supabase OB upsert failed: ${res.status} ${t}`);
    }
    written += batch.length;
  }

  return written;
}

module.exports = { upsertOB };
