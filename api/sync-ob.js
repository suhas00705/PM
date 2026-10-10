// OB (Sales Order line items) — Zoho CRM → Supabase sales_lines
//   /api/sync-ob                 daily: documents modified in the last 3 days
//   /api/sync-ob?days=10         daily with a wider catch-up window
//   /api/sync-ob?mode=full       every document since 29-Sep-2026 (resumable via resumeWith)
//   /api/sync-ob?mode=backfill   one-time: Zoho-approved FY26 OAs missing from the SAP Excel (list in lib/obBackfill.js)
module.exports = require('../lib/salesSync').handlerFor('OB');
