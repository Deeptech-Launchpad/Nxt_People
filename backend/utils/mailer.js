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

// Nothing leaves a developer machine unless somebody says so.
//
// This is here because it was not. Local test runs drove real leave
// applications through the real API, and the approval chain did its job: it
// mailed the actual reporting managers of the actual employees those tests
// had picked as subjects with SELECT ... LIMIT 1. Around a hundred messages
// reached colleagues' inboxes before anyone noticed.
//
// The flag is opt-OUT, and keys off an explicit variable rather than
// NODE_ENV. docker-compose passes NODE_ENV with a default of development, so
// a live deployment whose root .env omits it would read as development —
// guarding on that would silently stop every email in production, which is a
// far worse failure than the one being fixed. A machine that should not send
// has to say so out loud.
const mailDisabled = () => String(process.env.EMAIL_DISABLED || '').toLowerCase() === 'true';

// A narrower instrument than the blanket switch above: on a developer machine
// EMAIL_ALLOWLIST names the only addresses that may be written to, and every
// other recipient is dropped before the message is built. It exists so local
// work can still be checked against a real inbox without a test run reaching
// anybody else — which is exactly what went wrong: leave applications raised
// by tests notified the real reporting managers of the employees the tests had
// borrowed, and those people never agreed to be part of it.
//
// Unset means no filtering, so live is untouched. Setting it to an address
// that receives nothing on a given run is normal, not a failure.
const allowlist = () => String(process.env.EMAIL_ALLOWLIST || "")
  .split(",").map(a => a.trim().toLowerCase()).filter(Boolean);

const applyAllowlist = (recipients, field) => {
  const allowed = allowlist();
  if (!allowed.length) return recipients;
  const kept = recipients.filter(a => allowed.includes(String(a).toLowerCase()));
  const dropped = recipients.filter(a => !kept.includes(a));
  if (dropped.length) {
    console.warn("[mailer] EMAIL_ALLOWLIST dropped " + field + ":", dropped.join(", "));
  }
  return kept;
};

const createTransporter = () => {
  if (mailDisabled()) {
    // Same shape as a real transporter, so every send path in this file
    // behaves identically and no caller needs to know.
    return {
      sendMail: async (opts) => {
        console.warn('[mailer] EMAIL_DISABLED is set - not sending:',
          JSON.stringify({ to: opts.to, subject: opts.subject }));
        return { disabled: true, messageId: 'disabled', accepted: [], rejected: [] };
      },
      verify: async () => true,
    };
  }
  const transport = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  return {
    ...transport,
    verify: (...a) => transport.verify(...a),
    sendMail: async (message) => {
      const to = Array.isArray(message.to) ? message.to : [message.to].filter(Boolean);
      if (to.length === 0) {
        // Nobody left to write to — normally because the allowlist removed
        // everyone. Not an error, and not something to hand to the transport.
        console.warn("[mailer] nobody left to write to, message not sent:",
          JSON.stringify({ subject: message.subject }));
        return { skipped: true, accepted: [], rejected: [] };
      }
      return transport.sendMail(message);
    },
  };
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
// Every address the file sends to passes through here, which is why the
// allowlist is applied at this point rather than in sendMail alone:
// sendLeaveApprovalEmail and the other helpers build their own recipient
// lists through this same function, and filtering one caller would have left
// the rest free to reach anybody.
const sanitizeRecipients = (to, field = "to") => {
  const list = Array.isArray(to) ? to : [to];
  const valid = list
    .map(a => (typeof a === 'string' ? a.trim() : ''))
    .filter(a => a && !/[\r\n]/.test(a) && ADDR_RE.test(a));
  return applyAllowlist(valid, field);
};

const sendMail = async ({ to, cc, bcc, replyTo, subject, text, html, attachments }) => {
  const transporter = createTransporter();
  const recipients = sanitizeRecipients(to, "to");
  if (recipients.length === 0) {
    // With an allowlist in force this is the normal outcome for a message
    // aimed at somebody else, so it is not an error worth throwing over.
    if (allowlist().length) {
      console.warn("[mailer] every recipient was outside EMAIL_ALLOWLIST - nothing sent");
      return { skipped: true };
    }
    throw new Error('sendMail: no valid recipient addresses after sanitisation');
  }
  // Cc, Bcc and Reply-To go through the same sanitiser as To. A workflow's
  // email alert offers all three, and accepting them here without validating
  // would reopen the header-injection hole the To list is guarded against.
  const ccList = sanitizeRecipients(cc || [], "cc");
  const bccList = sanitizeRecipients(bcc || [], "bcc");
  const replyToList = sanitizeRecipients(replyTo || []);

  // Subject must not contain CR/LF either — same injection vector via Subject.
  const safeSubject = String(subject || '').replace(/[\r\n]+/g, ' ').slice(0, 998);
  await transporter.sendMail({
    from: `"${process.env.COMPANY_NAME || 'HR Team'}" <${process.env.EMAIL_USER}>`,
    to: recipients, // pass the array — nodemailer handles separator + escaping
    ...(ccList.length ? { cc: ccList } : {}),
    ...(bccList.length ? { bcc: bccList } : {}),
    ...(replyToList.length ? { replyTo: replyToList[0] } : {}),
    subject: safeSubject,
    text,
    html: html || `<pre style="font-family:sans-serif;font-size:14px;">${(text || '').replace(/</g, '&lt;')}</pre>`,
    // Attachments carry no header of their own for a caller to inject into,
    // but the filename lands in a Content-Disposition, so it gets the same
    // CR/LF treatment the subject does.
    ...(Array.isArray(attachments) && attachments.length
      ? { attachments: attachments.map(a => ({
            filename: String(a.filename || 'attachment').replace(/[\r\n]+/g, ' ').slice(0, 200),
            content: a.content,
            ...(a.contentType ? { contentType: a.contentType } : {}),
          })) }
      : {}),
  });
};

/**
 * Leave Approval Email — sent to approvers with a direct approval link.
 * Includes employee info, leave details, and a clickable approval button.
 */
const sendLeaveApprovalEmail = async ({ to, cc, bcc, replyTo, employeeName, leaveType, startDate, endDate, totalDays, reason, approvalLink, customSubject, hours, startTime, endTime }) => {
  const transporter = createTransporter();
  const dateRange = `${new Date(startDate).toLocaleDateString('en-IN')} ${endDate !== startDate ? `– ${new Date(endDate).toLocaleDateString('en-IN')}` : ''}`;
  const safeEmployeeName = escapeHtml(employeeName || 'Employee');
  const safeLeaveType = escapeHtml(leaveType || 'Leave');
  const safeDateRange = escapeHtml(dateRange);
  const safeReason = escapeHtml(reason || 'No reason provided');
  const safeLink = safeUrl(approvalLink);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Leave Approval Required</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f9; color: #1e293b; }
    .wrapper { max-width: 620px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 32px 40px; text-align: center; color: #ffffff; }
    .header-title { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .header-subtitle { font-size: 14px; opacity: 0.9; }
    .body { padding: 36px 40px; }
    .greeting { font-size: 18px; font-weight: 600; color: #1e293b; margin-bottom: 16px; }
    .details { background: #f8fafc; border-radius: 10px; padding: 20px; margin: 20px 0; border-left: 4px solid #3b82f6; }
    .detail-row { display: grid; grid-template-columns: 120px 1fr; gap: 12px; margin-bottom: 12px; font-size: 14px; }
    .detail-row:last-child { margin-bottom: 0; }
    .detail-label { font-weight: 600; color: #475569; }
    .detail-value { color: #1e293b; }
    .cta-box { background: #eff6ff; border: 2px solid #3b82f6; border-radius: 10px; padding: 24px; margin: 24px 0; text-align: center; }
    .cta-box-title { font-size: 15px; font-weight: 600; color: #1e40af; margin-bottom: 16px; }
    .cta-btn { display: inline-block; background: #3b82f6; color: #ffffff !important; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px; }
    .cta-btn:hover { background: #2563eb; }
    .alt-text { font-size: 12px; color: #64748b; margin-top: 12px; }
    .alt-text a { color: #3b82f6; text-decoration: none; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div style="display:inline-block; background:rgba(255,255,255,0.1); padding:8px 16px; border-radius:8px; margin-bottom:16px;">
        <span style="font-size:18px; font-weight:800; letter-spacing:0.5px;">NXT PEOPLE</span>
      </div>
      <div class="header-title">Leave Approval Required</div>
      <div class="header-subtitle">Please review and approve the following request</div>
    </div>

    <div class="body">
      <p class="greeting">Hi,</p>
      <p style="font-size:14px; color:#475569; line-height:1.7; margin-bottom:16px;"><strong>${safeEmployeeName}</strong> has requested <strong>${safeLeaveType}</strong> leave for your review and approval.</p>

      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Employee</span>
          <span class="detail-value">${safeEmployeeName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Leave Type</span>
          <span class="detail-value" style="text-transform:capitalize;">${safeLeaveType}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duration</span>
          <span class="detail-value">${safeDateRange}${hours ? ` · ${escapeHtml(startTime)} – ${escapeHtml(endTime)} (${hours} hr${Number(hours) !== 1 ? 's' : ''})` : ` (${totalDays} day${totalDays !== 1 ? 's' : ''})`}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Reason</span>
          <span class="detail-value">${safeReason}</span>
        </div>
      </div>

      <div class="cta-box">
        <div class="cta-box-title">Take Action</div>
        <a href="${safeLink}" class="cta-btn">Click Here to Approve</a>
        <p class="alt-text">Can't click the button? Copy this link:<br/><a href="${safeLink}">${safeLink}</a></p>
      </div>

      <p style="font-size:13px; color:#475569; line-height:1.6;">You can also visit <strong>NXT People → Team → Approvals</strong> to review all pending requests and take action.</p>

      <div class="divider"></div>
      <p style="font-size:12px; color:#64748b;">This is an automated notification. Please do not reply to this email.</p>
    </div>

    <div class="footer">
      <strong>NXT People</strong> · Your HR Management System
    </div>
  </div>
</body>
</html>
`;

  // Cc, Bcc and Reply-To go through the same sanitiser as To, and are omitted
  // entirely when empty rather than handed over as empty arrays.
  const ccList = sanitizeRecipients(cc || []);
  const bccList = sanitizeRecipients(bcc || []);
  const replyToList = sanitizeRecipients(replyTo || []);

  await transporter.sendMail({
    from: `"${process.env.COMPANY_NAME || 'NXT People'}" <${process.env.EMAIL_USER}>`,
    to: sanitizeRecipients(to),
    ...(ccList.length ? { cc: ccList } : {}),
    ...(bccList.length ? { bcc: bccList } : {}),
    ...(replyToList.length ? { replyTo: replyToList[0] } : {}),
    subject: customSubject || `[Action Required] ${safeEmployeeName} - ${safeLeaveType} Leave Approval`,
    html,
    text: `Leave Approval Required\n\n${safeEmployeeName} has requested ${safeLeaveType} leave (${safeDateRange}, ${totalDays} day(s)).\n\nReason: ${safeReason}\n\nClick here to approve: ${safeLink}\n\nOr visit NXT People → Team → Approvals`,
  });
};

/**
 * Check-Out Reminder Email — sent to employees at end of day.
 * Design matches the Check-In reminder email exactly (same blue gradient, layout, CTA style).
 */
const sendCheckOutReminderEmail = async ({ to, employeeName, subject, body }) => {
  if (body) {
    return sendMail({
      to,
      subject: subject || 'Please check out',
      text: body,
      html: renderTemplateEmail({
        title: subject || 'Check-out reminder',
        bodyText: body,
        linkLabel: 'Check out',
        linkUrl: (process.env.FRONTEND_URL || 'https://nxtpeople.altiusnxt.tech') + '/attendance/my',
      }),
    });
  }
  const transporter = createTransporter();
  const safeEmployeeName = escapeHtml(employeeName || 'Employee');
  const checkOutLink = safeUrl((process.env.FRONTEND_URL || 'https://ur.altiusnxt.tech') + '/attendance/my');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>End-of-Day Reminder</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f9; color: #1e293b; }
    .wrapper { max-width: 620px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 32px 40px; text-align: center; color: #ffffff; }
    .header-title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    .header-subtitle { font-size: 13px; opacity: 0.95; }
    .body { padding: 36px 40px; }
    .greeting { font-size: 16px; font-weight: 600; color: #1e293b; margin-bottom: 16px; }
    .content { font-size: 14px; color: #475569; line-height: 1.7; margin-bottom: 20px; }
    .checklist { margin: 16px 0 20px; }
    .checklist-item { font-size: 14px; color: #1e293b; line-height: 1.9; }
    .cta-box { background: #eff6ff; border: 2px solid #3b82f6; border-radius: 10px; padding: 24px; margin: 24px 0; text-align: center; }
    .cta-box-title { font-size: 14px; font-weight: 600; color: #1e40af; margin-bottom: 16px; }
    .cta-btn { display: inline-block; background: #3b82f6; color: #ffffff !important; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 700; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div style="display:inline-block; background:rgba(255,255,255,0.1); padding:8px 16px; border-radius:8px; margin-bottom:12px;">
        <span style="font-size:16px; font-weight:800; letter-spacing:0.5px;">NXT PEOPLE</span>
      </div>
      <div class="header-title">End-of-Day Reminder 🌆</div>
      <div class="header-subtitle">Please complete your check-out and submit your daily report</div>
    </div>
    <div class="body">
      <p class="greeting">Hello ${safeEmployeeName},</p>
      <p class="content">As you complete your workday, please ensure the following actions are completed:</p>
      <div class="checklist">
        <p class="checklist-item">✅ <strong>Check-Out from the HRMS Portal</strong></p>
        <p class="checklist-item">✅ <strong>Update Your Report</strong> — Click the button below</p>
        <p class="checklist-item">✅ <strong>Record completed tasks</strong> and key updates for the day</p>
      </div>
      <div class="cta-box">
        <a href="${checkOutLink}" target="_blank" class="cta-btn">Check Out Now</a>
      </div>
      <p class="content">Your daily updates help improve team visibility, productivity tracking, and work planning.</p>
      <p class="content">Thank you for your cooperation.</p>
      <div class="divider"></div>
      <p style="font-size:12px; color:#64748b;">This is an automated daily reminder from NXT People. Please do not reply to this email.</p>
    </div>
    <div class="footer"><strong>NXT People</strong> · Your HR Management System</div>
  </div>
</body>
</html>`;

  await transporter.sendMail({
    from: `"${process.env.COMPANY_NAME || 'NXT People'}" <${process.env.EMAIL_USER}>`,
    to: sanitizeRecipients(to),
    subject: 'ALTIUSNXT – End-of-Day Check-Out and Daily Production Report Submission',
    html,
    text: `Hello ${safeEmployeeName},\n\nAs you complete your workday, please ensure the following actions are completed:\n\n✅ Check-Out from the HRMS Portal\n✅ Update Your Report — Click the button below\n✅ Record completed tasks and key updates for the day.\n\nCheck Out Now: ${checkOutLink}\n\nYour daily updates help improve team visibility, productivity tracking, and work planning.\n\nThank you for your cooperation.\n\nRegards,\nNXT People\nYour HR Management System`,
  });
};

/**
 * Check-In Reminder Email — sent automatically at 9 AM each working day.
 */
/**
 * Wraps an admin-authored template body in the same branded shell the designed
 * emails use. Used when someone has edited the wording in
 * Settings → Attendance → Automation → Email Templates: their words are the
 * point, so they replace the copy, but the email should still look like ours.
 *
 * The body is escaped and its newlines become breaks — it is authored text, not
 * markup, and treating it as HTML would let a template inject anything.
 */
const renderTemplateEmail = ({ title, bodyText, linkLabel, linkUrl }) => {
  const safeBody = escapeHtml(bodyText || '').replace(/\n/g, '<br/>');
  const button = linkUrl
    ? `<tr><td style="padding:8px 32px 32px;"><a href="${safeUrl(linkUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600;">${escapeHtml(linkLabel || 'Open')}</a></td></tr>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${escapeHtml(title || '')}</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="padding:28px 32px 8px;font-size:17px;font-weight:600;color:#0f172a;">${escapeHtml(title || '')}</td></tr>
    <tr><td style="padding:8px 32px 24px;font-size:14px;line-height:1.65;color:#334155;">${safeBody}</td></tr>
    ${button}
    <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">${escapeHtml(process.env.COMPANY_NAME || 'NXT People')}</td></tr>
  </table>
</body></html>`;
};

const sendCheckInReminderEmail = async ({ to, employeeName, subject, body }) => {
  // An edited template replaces the designed email entirely — otherwise the
  // screen would report a change it never made.
  if (body) {
    return sendMail({
      to,
      subject: subject || 'Please check in for the day',
      text: body,
      html: renderTemplateEmail({
        title: subject || 'Check-in reminder',
        bodyText: body,
        linkLabel: 'Check in',
        linkUrl: (process.env.FRONTEND_URL || 'https://nxtpeople.altiusnxt.tech') + '/attendance/my',
      }),
    });
  }
  const transporter = createTransporter();
  const safeEmployeeName = escapeHtml(employeeName || 'Employee');
  const checkInLink = safeUrl((process.env.FRONTEND_URL || 'https://ur.altiusnxt.tech') + '/attendance/my');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Good Morning - Check-In Reminder</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f9; color: #1e293b; }
    .wrapper { max-width: 620px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 32px 40px; text-align: center; color: #ffffff; }
    .header-title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    .header-subtitle { font-size: 13px; opacity: 0.95; }
    .body { padding: 36px 40px; }
    .greeting { font-size: 16px; font-weight: 600; color: #1e293b; margin-bottom: 16px; }
    .content { font-size: 14px; color: #475569; line-height: 1.7; margin-bottom: 20px; }
    .cta-box { background: #eff6ff; border: 2px solid #3b82f6; border-radius: 10px; padding: 24px; margin: 24px 0; text-align: center; }
    .cta-box-title { font-size: 14px; font-weight: 600; color: #1e40af; margin-bottom: 16px; }
    .cta-btn { display: inline-block; background: #3b82f6; color: #ffffff !important; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 700; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div style="display:inline-block; background:rgba(255,255,255,0.1); padding:8px 16px; border-radius:8px; margin-bottom:12px;">
        <span style="font-size:16px; font-weight:800; letter-spacing:0.5px;">NXT PEOPLE</span>
      </div>
      <div class="header-title">Good Morning! ☀️</div>
      <div class="header-subtitle">Don't forget to check in for today</div>
    </div>
    <div class="body">
      <p class="greeting">Hello ${safeEmployeeName},</p>
      <p class="content">Wishing you a productive day ahead! Please remember to mark your attendance by checking in on NXT People.</p>
      <div class="cta-box">
        <div class="cta-box-title">Mark Your Attendance</div>
        <a href="${checkInLink}" target="_blank" class="cta-btn">Check In Now</a>
      </div>
      <div class="divider"></div>
      <p style="font-size:12px; color:#64748b;">This is an automated daily reminder from NXT People. Please do not reply to this email.</p>
    </div>
    <div class="footer"><strong>NXT People</strong> · Your HR Management System</div>
  </div>
</body>
</html>`;

  await transporter.sendMail({
    from: `"${process.env.COMPANY_NAME || 'NXT People'}" <${process.env.EMAIL_USER}>`,
    to: sanitizeRecipients(to),
    subject: 'Good Morning! Please check in for the day — NXT People',
    html,
    text: `Good morning ${safeEmployeeName},\n\nPlease remember to check in for the day on NXT People.\n\nCheck in here: ${checkInLink}\n\nHave a productive day!\n— NXT People`,
  });
};

/**
 * Leave Status Email — sent to the requesting employee when their leave
 * is approved at an intermediate level, fully approved, or rejected.
 * status: 'partial' | 'approved' | 'rejected'
 */
const sendLeaveStatusEmail = async ({ to, employeeName, leaveType, startDate, totalDays, hours, status, approverName, reason }) => {
  const transporter = createTransporter();
  const safeEmployeeName = escapeHtml(employeeName || 'Employee');
  const safeLeaveType    = escapeHtml(leaveType    || 'Leave');
  const safeStartDate    = escapeHtml(startDate    || '');
  const safeApprover     = escapeHtml(approverName || 'your approver');
  const safeReason       = escapeHtml(reason       || '');
  const trackLink        = safeUrl((process.env.FRONTEND_URL || 'https://ur.altiusnxt.tech') + '/leave-tracker/summary');
  const durationLabel    = hours ? `${hours} hour${Number(hours) !== 1 ? 's' : ''}` : `${Number(totalDays) || 0} day${Number(totalDays) !== 1 ? 's' : ''}`;

  const cfg = {
    partial: {
      gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      accentBg: '#fffbeb', border: '#fbbf24', btnColor: '#f59e0b',
      icon: '⏳', title: 'Approval In Progress',
      subtitle: 'Your request has been approved at one level',
      body: `Your <strong>${safeLeaveType}</strong> leave from <strong>${safeStartDate}</strong> (${durationLabel}) has been approved by ${safeApprover} and is now awaiting the next level of approval.`,
      btnText: 'Track Status',
    },
    approved: {
      gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      accentBg: '#f0fdf4', border: '#6ee7b7', btnColor: '#10b981',
      icon: '✅', title: 'Leave Approved',
      subtitle: 'Your leave request has been fully approved',
      body: `Great news! Your <strong>${safeLeaveType}</strong> leave from <strong>${safeStartDate}</strong> (${durationLabel}) has been fully approved. Enjoy your time off!`,
      btnText: 'View Leave Summary',
    },
    rejected: {
      gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
      accentBg: '#fef2f2', border: '#fca5a5', btnColor: '#ef4444',
      icon: '❌', title: 'Leave Request Rejected',
      subtitle: 'Your leave request could not be approved',
      body: `Your <strong>${safeLeaveType}</strong> leave from <strong>${safeStartDate}</strong> (${durationLabel}) has been rejected.${safeReason ? `<br/><strong>Reason:</strong> ${safeReason}` : ''} Please contact your manager or HR for more details.`,
      btnText: 'View Leave Tracker',
    },
  };

  const c = cfg[status] || cfg.approved;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${c.title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f9; color: #1e293b; }
    .wrapper { max-width: 620px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: ${c.gradient}; padding: 32px 40px; text-align: center; color: #ffffff; }
    .header-icon { font-size: 36px; margin-bottom: 12px; }
    .header-title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    .header-subtitle { font-size: 13px; opacity: 0.95; }
    .body { padding: 36px 40px; }
    .greeting { font-size: 16px; font-weight: 600; color: #1e293b; margin-bottom: 16px; }
    .message-box { background: ${c.accentBg}; border: 1px solid ${c.border}; border-radius: 10px; padding: 20px; margin: 20px 0; font-size: 14px; color: #475569; line-height: 1.7; }
    .cta-box { text-align: center; margin: 24px 0; }
    .cta-btn { display: inline-block; background: ${c.btnColor}; color: #ffffff !important; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 700; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div style="display:inline-block; background:rgba(255,255,255,0.1); padding:8px 16px; border-radius:8px; margin-bottom:12px;">
        <span style="font-size:16px; font-weight:800; letter-spacing:0.5px;">NXT PEOPLE</span>
      </div>
      <div class="header-icon">${c.icon}</div>
      <div class="header-title">${c.title}</div>
      <div class="header-subtitle">${c.subtitle}</div>
    </div>
    <div class="body">
      <p class="greeting">Hello ${safeEmployeeName},</p>
      <div class="message-box">${c.body}</div>
      <div class="cta-box">
        <a href="${trackLink}" target="_blank" class="cta-btn">${c.btnText}</a>
      </div>
      <div class="divider"></div>
      <p style="font-size:12px; color:#64748b;">This is an automated notification from NXT People. Please do not reply to this email.</p>
    </div>
    <div class="footer"><strong>NXT People</strong> · Your HR Management System</div>
  </div>
</body>
</html>`;

  const plainBody = status === 'partial'
    ? `Your ${leaveType} leave from ${startDate} (${safeDays} days) has been approved by ${approverName || 'your approver'} and is awaiting the next level.`
    : status === 'approved'
    ? `Your ${leaveType} leave from ${startDate} (${safeDays} days) has been fully approved.`
    : `Your ${leaveType} leave from ${startDate} (${safeDays} days) was rejected.${reason ? ` Reason: ${reason}` : ''}`;

  await transporter.sendMail({
    from: `"${process.env.COMPANY_NAME || 'NXT People'}" <${process.env.EMAIL_USER}>`,
    to: sanitizeRecipients(to),
    subject: `${c.title} — ${safeLeaveType} Leave (${safeStartDate})`,
    html,
    text: `Hello ${safeEmployeeName},\n\n${plainBody}\n\nTrack your leave: ${trackLink}\n\n— NXT People`,
  });
};

module.exports = { sendOnboardingEmail, sendLeaveApprovalEmail, sendCheckOutReminderEmail, sendCheckInReminderEmail, sendLeaveStatusEmail, sendMail, renderTemplateEmail };
