# Channel Partner Analytics — one-time setup

Four steps, in this order. Total time ~15 minutes.

## 1. Create the table in Supabase (2 min)
Supabase → your project → **SQL Editor** → New query → paste all of `supabase/cp_analytics.sql` → **Run**.
Creates `sales_lines`, `sales_sync_log`, the Excel-shaped views `ob_data` / `invoice_data`, and the dashboard functions.
Safe to run again.

## 2. Add one secret to Vercel (2 min)
Supabase → **Project Settings → API** → copy the **service_role** key (the secret one, not anon).
Vercel → project → **Settings → Environment Variables** → add
`SUPABASE_SERVICE_ROLE_KEY` = that key (Production + Preview) → Save.

## 3. Load the history (Apr-2025 → 28-Sep-2026) (5 min)
Needs Node.js 18+ (`node -v`). In CMD:
```
cd C:\Users\suhas.s\Downloads\PMportalready
node data-import\load-sales-history.js PASTE_SERVICE_ROLE_KEY_HERE
```
Expected at the end: OB (Excel) 67935 rows, Invoice (Excel) 70271 rows.

## 4. Push and run the first Zoho sync (5 min)
Run `push-to-git.bat`, wait for Vercel to deploy, then open these two once in a browser:
```
https://project-management-elmeasure.vercel.app/api/sync-ob?mode=full
https://project-management-elmeasure.vercel.app/api/sync-invoice?mode=full
```
Each should return `"ok": true`. That pulls everything from 29-Sep-2026 onward.
From then on the scheduled task does it every morning.

## How the daily sync works
* `/api/sync-ob` and `/api/sync-invoice` pull every Sales Order / Invoice **modified in the last 3 days**
  (created on/after 29-Sep-2026) at line-item level, with all Excel columns.
* Re-running never duplicates (each Zoho line has a fixed key). Edited orders are refreshed,
  removed lines and Rejected/Cancelled documents are deleted.
* Every run writes a row to `sales_sync_log`; the dashboard header shows the last sync time.
* Missed a few days? `/api/sync-ob?days=10` catches up. Full rebuild of Zoho data: `?mode=full`.
* Dashboard value = **DocTotalFC**. Avg discount = 1 − Line Total ÷ (List Price × Qty).
