// Invoice line items — Zoho CRM → Supabase sales_lines
//   /api/sync-invoice            daily: documents modified in the last 3 days
//   /api/sync-invoice?days=10    daily with a wider catch-up window
//   /api/sync-invoice?mode=full  every document since 29-Sep-2026 (resumable via resumeWith)
module.exports = require('../lib/salesSync').handlerFor('INV');
