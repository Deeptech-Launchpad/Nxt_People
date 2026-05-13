const nodemailer = require('nodemailer');

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
      <p class="greeting">Dear ${candidateName || 'Candidate'},</p>
      <p class="company-tag">Greetings from ${companyName || 'AltiusNxt'}!</p>

      <p>We're excited to have you join our team. As part of the onboarding process, we kindly request you to <strong>complete your employee registration</strong> by providing the necessary details through the secure link below.</p>

      <!-- CTA Button -->
      <div class="cta-box">
        <p>Click the button below to begin your onboarding process</p>
        <a href="${registrationLink}" class="cta-btn">Start Onboarding &rarr;</a>
        <p style="margin-top:12px; font-size:12px; color:#94a3b8;">Or copy this link: <a href="${registrationLink}" style="color:#9b1c1c; word-break:break-all;">${registrationLink}</a></p>
      </div>

      <!-- Important Notes -->
      <div class="notes-box">
        <h4>Important Notes</h4>
        <ul>
          <li>This link is secure and intended only for your use.</li>
          ${dueDateStr ? `<li>Kindly complete the process <strong>on or before ${dueDateStr}</strong>.</li>` : ''}
          <li>Keep your documents ready before starting (ID proof, educational certificates, bank details, etc.).</li>
          <li>Fill in all required information accurately to avoid delays in your joining process.</li>
        </ul>
      </div>

      ${dueDateStr ? `<div class="deadline">⏰ Deadline: Please complete registration by <strong>${dueDateStr}</strong></div>` : ''}

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

      <p class="contact">If you face any issues while completing the form, please reach out to us at <a href="mailto:${hrEmail || 'hr@company.com'}">${hrEmail || 'hr@company.com'}</a>${hrPhone ? ` or call <strong>${hrPhone}</strong>` : ''}.</p>

      <p style="margin-top:16px;">We look forward to welcoming you to <strong>${companyName || 'our team'}</strong> and wish you a successful journey with us.</p>

      <p style="margin-top:20px; color:#1e293b;">
        Best regards,<br/>
        <strong>${hrName || 'HR Team'}</strong><br/>
        <span style="color:#9b1c1c;">${companyName || 'AltiusNxt'}</span>
      </p>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>This is an automated onboarding invitation sent by <strong>${companyName || 'AltiusNxt'} HR Team</strong>.</p>
      <p style="margin-top:4px;">Please do not reply to this email. For assistance, contact your HR representative.</p>
    </div>
  </div>
</body>
</html>
  `;

  await transporter.sendMail({
    from: `"${companyName || 'AltiusNxt'} HR" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Complete Your Employee Onboarding Process – ${companyName || 'AltiusNxt'}`,
    html,
  });
};

/**
 * Generic transactional sender. Used by holiday notifications and other
 * one-off broadcasts. `to` may be a single email or an array.
 */
const sendMail = async ({ to, subject, text, html }) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"${process.env.COMPANY_NAME || 'HR Team'}" <${process.env.EMAIL_USER}>`,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    text,
    html: html || `<pre style="font-family:sans-serif;font-size:14px;">${(text || '').replace(/</g, '&lt;')}</pre>`,
  });
};

module.exports = { sendOnboardingEmail, sendMail };
