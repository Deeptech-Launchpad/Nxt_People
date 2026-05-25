const nodemailer = require('nodemailer');

// Minimal HTML escape — used for every template variable that gets
// interpolated into the email body. Without this, a candidate name
// containing `<script>` (or even just `<` from `Smith <CEO>`) renders
// as HTML in the recipient's email client. We deliberately don't depend
// on a library here; the template engine touches only 4 character
// classes and the surface is tiny.
const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// URL guard for hrefs — only allow http/https/mailto schemes so a
// caller-controlled `registrationLink` can't be `javascript:alert(1)`.
// Falls back to '#' which renders the button safely as a no-op.
const safeUrl = (u) => {
  const s = String(u ?? '').trim();
  return /^(https?:|mailto:)/i.test(s) ? s : '#';
};

const createTransporter = () => {
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const sendOnboardingEmail = async ({ to, candidateName, dueDate, registrationLink, companyName, hrName, hrEmail, hrPhone }) => {
  const transporter = createTransporter();
  const dueDateStr = dueDate
    ? new Date(dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  // Pre-escape every caller-supplied variable. Defence in depth — these
  // values come from HR's admin form today, but the same template is reused
  // by self-onboarding flows and an attacker-controlled name field would
  // otherwise execute as HTML in the recipient's inbox.
  const safeCandidate = escapeHtml(candidateName || 'Candidate');
  const safeCompany   = escapeHtml(companyName  || 'AltiusNxt');
  const safeHrName    = escapeHtml(hrName       || 'HR Team');
  const safeHrEmail   = escapeHtml(hrEmail      || 'hr@company.com');
  const safeHrPhone   = escapeHtml(hrPhone || '');
  const safeDueDate   = escapeHtml(dueDateStr   || '');
  const safeLink      = safeUrl(registrationLink);
  const safeLinkLabel = escapeHtml(safeLink);
  const safeMailto    = safeUrl(`mailto:${hrEmail || 'hr@company.com'}`);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Employee Onboarding</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f9; color: #1e293b; }
    .wrapper { max-width: 620px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: #9b1c1c; padding: 32px 40px; text-align: center; }
    .header img { height: 44px; width: auto; }
    .header-bar { width: 60px; height: 3px; background: #c0392b; margin: 16px auto 0; border-radius: 2px; }
    .body { padding: 36px 40px; }
    .greeting { font-size: 22px; font-weight: 700; color: #1e293b; margin-bottom: 6px; }
    .company-tag { font-size: 14px; color: #9b1c1c; font-weight: 600; margin-bottom: 20px; }
    p { font-size: 14px; color: #475569; line-height: 1.7; margin-bottom: 14px; }
    .cta-box { background: #fff1f1; border: 1px solid #ffc7c7; border-radius: 10px; padding: 20px 24px; margin: 24px 0; text-align: center; }
    .cta-box p { margin-bottom: 14px; font-weight: 500; color: #374151; }
    .cta-btn { display: inline-block; background: #9b1c1c; color: #ffffff !important; text-decoration: none; padding: 13px 32px; border-radius: 8px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px; }
    .cta-btn:hover { background: #7f1d1d; }
    .notes-box { background: #f8fafc; border-left: 4px solid #9b1c1c; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
    .notes-box h4 { font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    .notes-box ul { padding-left: 18px; }
    .notes-box ul li { font-size: 13px; color: #475569; margin-bottom: 5px; line-height: 1.5; }
    .docs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0; }
    .doc-item { background: #f1f5f9; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #475569; display: flex; align-items: center; gap: 6px; }
    .doc-item::before { content: '📄'; }
    .deadline { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #92400e; font-weight: 500; margin: 16px 0; text-align: center; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    .contact { font-size: 13px; color: #64748b; }
    .contact a { color: #9b1c1c; text-decoration: none; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
    .footer strong { color: #64748b; }
  </style>
</head>
<body>
  <div class="wrapper">
    <!-- Header -->
    <div class="header">
      <div style="background:#fff; display:inline-block; padding:8px 16px; border-radius:8px;">
        <span style="font-size:20px; font-weight:800; color:#9b1c1c; letter-spacing:1px;">NXT PEOPLE</span>
      </div>
      <p style="color:#fca5a5; font-size:13px; margin-top:10px;">HR & People Management Platform</p>
    </div>

    <!-- Body -->
    <div class="body">
      <p class="greeting">Dear ${safeCandidate},</p>
      <p class="company-tag">Greetings from ${safeCompany}!</p>

      <p>We're excited to have you join our team. As part of the onboarding process, we kindly request you to <strong>complete your employee registration</strong> by providing the necessary details through the secure link below.</p>

      <!-- CTA Button -->
      <div class="cta-box">
        <p>Click the button below to begin your onboarding process</p>
        <a href="${safeLink}" class="cta-btn">Start Onboarding &rarr;</a>
        <p style="margin-top:12px; font-size:12px; color:#94a3b8;">Or copy this link: <a href="${safeLink}" style="color:#9b1c1c; word-break:break-all;">${safeLinkLabel}</a></p>
      </div>

      <!-- Important Notes -->
      <div class="notes-box">
        <h4>Important Notes</h4>
        <ul>
          <li>This link is secure and intended only for your use.</li>
          ${safeDueDate ? `<li>Kindly complete the process <strong>on or before ${safeDueDate}</strong>.</li>` : ''}
          <li>Keep your documents ready before starting (ID proof, educational certificates, bank details, etc.).</li>
          <li>Fill in all required information accurately to avoid delays in your joining process.</li>
        </ul>
      </div>

      ${safeDueDate ? `<div class="deadline">⏰ Deadline: Please complete registration by <strong>${safeDueDate}</strong></div>` : ''}

      <!-- Documents to keep ready -->
      <p style="font-weight:600; color:#1e293b; margin-bottom:8px;">Please keep the following documents ready for upload:</p>
      <div class="docs-grid">
        <div class="doc-item">Resume / CV</div>
        <div class="doc-item">Offer Letter</div>
        <div class="doc-item">Aadhaar Card</div>
        <div class="doc-item">PAN Card</div>
        <div class="doc-item">Passport (if any)</div>
        <div class="doc-item">Address Proof</div>
        <div class="doc-item">Educational Certificates</div>
        <div class="doc-item">Experience Letters</div>
        <div class="doc-item">Bank Account Details</div>
        <div class="doc-item">Passport Size Photo</div>
      </div>

      <hr class="divider"/>

      <p class="contact">If you face any issues while completing the form, please reach out to us at <a href="${safeMailto}">${safeHrEmail}</a>${safeHrPhone ? ` or call <strong>${safeHrPhone}</strong>` : ''}.</p>

      <p style="margin-top:16px;">We look forward to welcoming you to <strong>${safeCompany}</strong> and wish you a successful journey with us.</p>

      <p style="margin-top:20px; color:#1e293b;">
        Best regards,<br/>
        <strong>${safeHrName}</strong><br/>
        <span style="color:#9b1c1c;">${safeCompany}</span>
      </p>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>This is an automated onboarding invitation sent by <strong>${safeCompany} HR Team</strong>.</p>
      <p style="margin-top:4px;">Please do not reply to this email. For assistance, contact your HR representative.</p>
    </div>
  </div>
</body>
</html>
  `;

  // Header-safe versions of the display name + subject. CR/LF in either
  // would be interpreted as header separators and could inject Bcc.
  const headerSafeCompany = String(companyName || 'AltiusNxt').replace(/[\r\n"<>]+/g, ' ').slice(0, 80);
  const subject = `Complete Your Employee Onboarding Process – ${headerSafeCompany}`.replace(/[\r\n]+/g, ' ').slice(0, 998);
  const recipients = sanitizeRecipients(to);
  if (recipients.length === 0) {
    throw new Error('sendOnboardingEmail: no valid recipient addresses after sanitisation');
  }
  await transporter.sendMail({
    from: `"${headerSafeCompany} HR" <${process.env.EMAIL_USER}>`,
    to: recipients,
    subject,
    html,
  });
};

/**
 * Generic transactional sender. Used by holiday notifications and other
 * one-off broadcasts. `to` may be a single email or an array.
 *
 * Header-injection guard:
 *   - If a caller hands us "bob@x.com\nBcc: attacker@evil.com" as a string
 *     element, the raw newline would be interpreted as the start of a new
 *     SMTP header. Joining the array with ", " (the old code) made that a
 *     valid-looking comma-separated list with an embedded CR/LF.
 *   - Defense: validate every address against a simple RFC-ish regex, drop
 *     anything that fails, and hand nodemailer the *array* — its address
 *     parser already CRLF-escapes per RFC. Refuse to send if no addresses
 *     remain so we never silently broadcast a deliverable email to nobody.
 */
const ADDR_RE = /^[^\s,;<>"'()\\[\]@]+@[^\s,;<>"'()\\[\]@]+\.[^\s,;<>"'()\\[\]@]+$/;
const sanitizeRecipients = (to) => {
  const list = Array.isArray(to) ? to : [to];
  return list
    .map(a => (typeof a === 'string' ? a.trim() : ''))
    .filter(a => a && !/[\r\n]/.test(a) && ADDR_RE.test(a));
};

const sendMail = async ({ to, subject, text, html }) => {
  const transporter = createTransporter();
  const recipients = sanitizeRecipients(to);
  if (recipients.length === 0) {
    throw new Error('sendMail: no valid recipient addresses after sanitisation');
  }
  // Subject must not contain CR/LF either — same injection vector via Subject.
  const safeSubject = String(subject || '').replace(/[\r\n]+/g, ' ').slice(0, 998);
  await transporter.sendMail({
    from: `"${process.env.COMPANY_NAME || 'HR Team'}" <${process.env.EMAIL_USER}>`,
    to: recipients, // pass the array — nodemailer handles separator + escaping
    subject: safeSubject,
    text,
    html: html || `<pre style="font-family:sans-serif;font-size:14px;">${(text || '').replace(/</g, '&lt;')}</pre>`,
  });
};

module.exports = { sendOnboardingEmail, sendMail };
