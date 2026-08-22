// api/user-permissions.js
// Manages user access permissions for the PM Portal.
//
//   GET  /api/user-permissions?email=x@elmeasure.com   → single user record
//   GET  /api/user-permissions                         → all users (admin only)
//   POST /api/user-permissions                         → upsert a user (admin only)
//   DELETE /api/user-permissions?email=x&adminEmail=y  → remove a user (admin only)

const SUPABASE_URL  = 'https://xfdfbrfudsaxqgpsdboa.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGZicmZ1ZHNheHFncHNkYm9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTA1MzgsImV4cCI6MjA5NzM2NjUzOH0.sfUC5Mn_d7-FGkvQHyD01kdGM81TjG4VWzXoFv43n94';
const TABLE_URL     = `${SUPABASE_URL}/rest/v1/user_permissions`;
const ADMIN_EMAIL   = 'suhas.s@elmeasure.com';

const SB_HEADERS = {
  apikey:        SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer:        'return=representation'
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { method, query } = req;

  // ── GET ────────────────────────────────────────────────────────────────────
  if (method === 'GET') {
    const email = query.email;

    if (email) {
      // Single user lookup (used at login time — any authenticated user can check themselves)
      const r = await fetch(`${TABLE_URL}?email=eq.${encodeURIComponent(email)}&select=*`, {
        headers: SB_HEADERS
      });
      const rows = await r.json();
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.status(200).json(rows[0]);
    }

    // All users — admin only check is enforced client-side; this returns all rows
    const r = await fetch(`${TABLE_URL}?select=*&order=created_at.asc`, {
      headers: SB_HEADERS
    });
    const rows = await r.json();
    return res.status(200).json(rows);
  }

  // ── POST (upsert) ──────────────────────────────────────────────────────────
  if (method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const { adminEmail, email, allowed_tabs, allowed_regions, is_active } = body;

    // Basic admin check
    if (adminEmail !== ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (!email || !email.endsWith('@elmeasure.com')) {
      return res.status(400).json({ error: 'Only @elmeasure.com emails are allowed' });
    }

    // Build payload — only include fields that were provided
    const payload = { email };
    if (allowed_tabs   !== undefined) payload.allowed_tabs   = allowed_tabs;
    if (allowed_regions !== undefined) payload.allowed_regions = allowed_regions;
    if (is_active      !== undefined) payload.is_active      = is_active;

    const r = await fetch(`${TABLE_URL}?on_conflict=email`, {
      method:  'POST',
      headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
      body:    JSON.stringify(payload)
    });
    const result = await r.json();
    if (!r.ok) return res.status(r.status).json(result);
    return res.status(200).json(result[0] || result);
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (method === 'DELETE') {
    const { email, adminEmail } = query;

    if (adminEmail !== ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (!email) {
      return res.status(400).json({ error: 'email query param required' });
    }
    // Prevent deleting the admin account
    if (email === ADMIN_EMAIL) {
      return res.status(400).json({ error: 'Cannot remove the admin account' });
    }

    const r = await fetch(`${TABLE_URL}?email=eq.${encodeURIComponent(email)}`, {
      method:  'DELETE',
      headers: SB_HEADERS
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: err });
    }
    return res.status(200).json({ deleted: email });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
