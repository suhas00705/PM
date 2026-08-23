// api/send-email.js
// Sends an email notification when a user's PM Portal permissions are added or updated.
// Uses Zoho Mail SMTP via Nodemailer.
// Required Vercel env vars:
//   ZOHO_USER      - your Zoho Mail address (e.g. suhas.s@elmeasure.com)
//   ZOHO_APP_PASS  - Zoho Mail App Password (generated in accounts.zoho.in → Security → App Passwords)

const nodemailer = require('nodemailer');

const ADMIN_EMAIL = 'suhas.s@elmeasure.com';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { toEmail, tabs, regions, isNew, changedBy } = req.body || {};

  if (!toEmail) return res.status(400).json({ error: 'toEmail is required' });

  const zohoUser = process.env.ZOHO_USER;
  const zohoPass = process.env.ZOHO_APP_PASS;

  if (!zohoUser || !zohoPass) {
    console.error('ZOHO_USER or ZOHO_APP_PASS env vars not set');
    return res.status(200).json({ skipped: true, reason: 'Email credentials not configured' });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.in',
    port: 587,
    secure: false, // STARTTLS
    auth: { user: zohoUser, pass: zohoPass }
  });

  const regionList = (regions && regions.length) ? regions.join(', ') : 'All Regions';
  const tabList    = (tabs    && tabs.length)    ? tabs.join(', ')    : 'None';
  const action     = isNew ? 'has been granted access to' : 'permissions have been updated on';

  const html = `
    <div style="font-family:Calibri,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #d8dce6;border-radius:10px;">
      <div style="background:#0073C8;padding:16px 20px;border-radius:8px 8px 0 0;margin:-24px -24px 20px;">
        <span style="color:#fff;font-size:16px;font-weight:700;">ELMEASURE — PM Portal</span>
      </div>
      <p style="color:#16264d;font-size:14px;margin:0 0 14px;">Hello,</p>
      <p style="color:#16264d;font-size:14px;margin:0 0 16px;">
        Your account (<strong>${toEmail}</strong>) ${action} the <strong>PM Portal</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
        <tr style="background:#f4f6fa;">
          <td style="padding:10px 14px;font-weight:700;color:#3b5384;border:1px solid #d8dce6;width:140px;">Tabs Accessible</td>
          <td style="padding:10px 14px;color:#16264d;border:1px solid #d8dce6;">${tabList}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-weight:700;color:#3b5384;border:1px solid #d8dce6;">Regions</td>
          <td style="padding:10px 14px;color:#16264d;border:1px solid #d8dce6;">${regionList}</td>
        </tr>
      </table>
      <div style="text-align:center;margin-bottom:20px;">
        <a href="https://pm-portal-rouge.vercel.app"
           style="display:inline-block;background:#0073C8;color:#fff;text-decoration:none;
                  padding:11px 28px;border-radius:7px;font-size:13px;font-weight:700;">
          🔗 Open PM Portal
        </a>
      </div>
      <p style="color:#7a8fb8;font-size:12px;margin:0 0 6px;">
        If you have any questions, contact <a href="mailto:${ADMIN_EMAIL}" style="color:#0073C8;">${ADMIN_EMAIL}</a>.
      </p>
      <p style="color:#7a8fb8;font-size:11px;margin:0;">This is an automated notification from PM Portal.</p>
    </div>
  `;

  const mailOptions = {
    from: `"PM Portal Admin" <${zohoUser}>`,
    to: toEmail,
    cc: ADMIN_EMAIL,
    subject: isNew
      ? `PM Portal Access Granted — ${toEmail}`
      : `PM Portal Permissions Updated — ${toEmail}`,
    html
  };

  try {
    await transporter.sendMail(mailOptions);
    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('Email send error:', err.message);
    return res.status(200).json({ skipped: true, reason: err.message });
  }
};
