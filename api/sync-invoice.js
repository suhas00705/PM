// Invoice line items — Zoho CRM → Supabase sales_lines
//   /api/sync-invoice            daily: documents modified in the last 3 days
//   /api/sync-invoice?days=10    daily with a wider catch-up window
//   /api/sync-invoice?mode=full  every document since 29-Sep-2026 (resumable via resumeWith)
//   /api/sync-invoice?mode=gapfill&from=2025-04-01&to=2026-09-28[&dry=1]  adds Zoho invoices missing from the
//        Excel history (service invoices 261103xxx etc.), resumable via resumeWith
//   /api/sync-invoice?mode=pending  copies Zoho "Pending Orders" (pending to bill) – run by cron-2h
module.exports = require('../lib/salesSync').handlerFor('INV');
