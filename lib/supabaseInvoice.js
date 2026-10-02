const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const TABLE = 'invoice_cache';

function mapRow(cols, row) {
  const r = {};
  cols.forEach((c, i) => { r[c] = row[i]; });

  const parseDate = (v) => {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const m = v.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})/);
    if (m) {
      const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                       Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
      return `${m[3]}-${months[m[2]]}-${m[1]}`;
    }
    return null;
  };

  // Invoice has two date columns: 'Docdate' and 'DocDate' — use Docdate as primary
  return {
    row_id:            parseInt(r['#']) || null,
    company:           r['Company'] || null,
    doc_num:           parseInt(r['DocNum']) || null,
    doc_date:          parseDate(r['Docdate'] || r['DocDate']),
    card_name:         r['CardName'] || null,
    oa_no:             r['OA No'] || null,
    u_internal:        r['U_Internal'] || null,
    account_type:      r['U_Accounttype'] || null,
    product_category:  r['U_ProductCategory'] || null,
    product_basket:    r['Product Basket'] || null,
    product_series:    r['Product Series'] || null,
    items_grp_nam:     r['ItmsGrpNam'] || null,
    item_code:         parseInt(r['ItemCode']) || null,
    cat_code:          r['Cat Code'] || null,
    description:       r['Dscription'] || null,
    extra_description: r['Extra Description'] || null,
    model_id:          r['U_ModelId'] || null,
    series_name:       r['U_SeriesName'] || null,
    quantity:          parseFloat(r['Quantity']) || null,
    price:             parseFloat(r['Price']) || null,
    disc_prcnt:        parseFloat(r['DiscPrcnt']) || null,
    list_price:        parseFloat(r['List Price']) || null,
    doc_total:         parseFloat(r['DocTotal']) || null,
    line_total:        parseFloat(r['Line Total']) || null,
    tax_calc:          parseFloat(r['Tax calc']) || null,
    freight_charges:   parseFloat(r['Frieght/Packing Charges']) || null,
    doc_total_fc:      parseFloat(r['DocTotalFC']) || null,
    billing_city:      r['Billing City'] || null,
    billing_state:     r['Billing State'] || null,
    slp_name:          r['SlpName'] || null,
    se_reg:            r['U_SEReg'] || null,
    synced_at:         new Date().toISOString(),
  };
}

async function upsertInvoices(columns, rows) {
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
      throw new Error(`Supabase Invoice upsert failed: ${res.status} ${t}`);
    }
    written += batch.length;
  }

  return written;
}

module.exports = { upsertInvoices };
