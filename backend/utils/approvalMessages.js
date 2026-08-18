/**
 * utils/approvalMessages.js
 *
 * Makes the Messages card on Settings > Approvals govern the email that
 * actually goes out.
 *
 * Until this existed the card was decoration: From, To, Subject, the body
 * template and the two "also tell the requester" switches were validated,
 * stored in approval_rules.messages, and read by nothing. Every approval email
 * used wording hard-coded in mailer.js, so an admin could rename the subject,
 * pick a template, switch the rejected notice off, save, see it persist — and
 * nothing about the mail would change.
 *
 * The governing rule is chosen the same way the approval chain is chosen: the
 * first active rule in sort order whose criteria match. If the two disagreed,
 * the email would describe a chain other than the one that ran.
 */
const pool = require('../db');
const logger = require('../logger');
const { pickRule } = require('./approvalRules');
const { render } = require('./automationConfig');

// A rule that cannot be resolved must never stop a request being raised, so
// every failure here degrades to "use the built-in wording" rather than throw.
async function messagesFor(requestType, record) {
  try {
    const rule = await pickRule(pool, requestType, record);
    return rule?.messages || null;
  } catch (err) {
    logger.warn({ err: err.message, requestType }, '[approvals] could not resolve the message rule');
    return null;
  }
}

// The To chips decide who is written to. current_approver is the level that is
// actually pending — the approvers the caller already resolved — and the other
// two are looked up here so a chip cannot silently resolve to nobody.
async function recipientsFor(messages, { approverEmails = [], employeeId } = {}) {
  const chips = messages?.to?.length ? messages.to : ['current_approver'];
  const out = new Set();

  if (chips.includes('current_approver')) approverEmails.filter(Boolean).forEach(e => out.add(e));

  if (employeeId && (chips.includes('requester') || chips.includes('reporting_manager'))) {
    const r = await pool.query(
      `SELECT e.email AS own, m.email AS manager
         FROM employees e
         LEFT JOIN employees m
           ON m.id = e.reporting_manager_id AND m.deleted_at IS NULL AND m.status = 'active'
        WHERE e.id = $1`,
      [employeeId]
    ).catch(() => ({ rows: [] }));
    const row = r.rows[0] || {};
    if (chips.includes('requester') && row.own) out.add(row.own);
    if (chips.includes('reporting_manager') && row.manager) out.add(row.manager);
  }

  return [...out];
}

/**
 * The chosen template rendered against the request, or null when no template is
 * chosen — in which case the caller keeps its own built-in HTML. Returning null
 * rather than a bare fallback is what preserves the existing formatted emails
 * for everybody who never picked a template.
 */
async function renderTemplate(templateName, vars) {
  if (!templateName) return null;
  const r = await pool.query(
    `SELECT subject, body FROM email_templates WHERE name = $1 LIMIT 1`, [templateName]
  ).catch(() => ({ rows: [] }));
  const t = r.rows[0];
  if (!t) {
    // A renamed or deleted template must not silently send a blank email.
    logger.warn({ templateName }, '[approvals] the configured template no longer exists');
    return null;
  }
  return { subject: render(t.subject || '', vars), html: render(t.body || '', vars) };
}

/**
 * Everything the "a request is waiting" email needs, resolved from the rule.
 * @returns {{to: string[], cc, bcc, replyTo, subject: string|null, html: string|null}}
 */
async function approvalEmail({ requestType, record, approverEmails, employeeId, vars = {} }) {
  const messages = await messagesFor(requestType, record);
  const to = await recipientsFor(messages, { approverEmails, employeeId });
  const rendered = await renderTemplate(messages?.templateName, vars);
  return {
    to,
    cc: messages?.cc || [],
    bcc: messages?.bcc || [],
    replyTo: messages?.replyTo || [],
    // The rule's subject wins over the built-in one; the template's own subject
    // wins over both, because picking a template means taking its wording.
    subject: rendered?.subject || (messages?.subject ? render(messages.subject, vars) : null),
    html: rendered?.html || null,
  };
}

/**
 * Whether the requester is told about a decision, and with what wording.
 * @param event 'approved' | 'rejected'
 */
async function outcomeEmail({ requestType, record, event, vars = {} }) {
  const messages = await messagesFor(requestType, record);
  const cfg = messages?.[event === 'approved' ? 'onApproved' : 'onRejected'];
  // Absent config means the switch was never touched, and the switch defaults
  // to on — silence is not the same as "switched off".
  if (cfg && cfg.enabled === false) return { send: false };
  const rendered = await renderTemplate(cfg?.templateName, vars);
  return {
    send: true,
    subject: rendered?.subject || null,
    html: rendered?.html || null,
    cc: messages?.cc || [],
    bcc: messages?.bcc || [],
    replyTo: messages?.replyTo || [],
  };
}

module.exports = { approvalEmail, outcomeEmail, messagesFor, recipientsFor, renderTemplate };
