/**
 * utils/orgPolicy.js
 *
 * Organisation policy, and the two-layer rule its personal-information card
 * describes.
 *
 * The card reads "Enable to give employees the choice to share or hide their
 * birthday". That is two decisions, not one:
 *
 *   layer 1  the organisation decides whether the choice exists at all
 *   layer 2  the employee makes it, in employees.privacy_prefs
 *
 * With the org toggle OFF nobody gets a choice and the field is shown, which is
 * how the directory behaved before any of this existed. With it ON the
 * employee's own preference decides, defaulting to shared.
 *
 * Read per request rather than cached: these gate what a directory shows, and a
 * stale copy would keep publishing a field somebody has just hidden.
 */
const pool = require('../db');

async function orgPolicy() {
  const r = await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`)
    .catch(() => ({ rows: [] }));
  return r.rows[0]?.c || {};
}

/**
 * Whether `field` should be visible for an employee row.
 * @param field 'birthday' | 'workAnniversary' | 'mobileNumber'
 */
function fieldVisible(field, policy, prefs) {
  const choiceOffered = !!policy?.personalInformation?.[field];
  if (!choiceOffered) return true;          // no choice on offer, so nothing is hidden
  const p = prefs || {};
  return p[field] !== false;                // the employee's own call, defaulting to shared
}

/** Strips the fields an employee has chosen to hide, in place-safe fashion. */
function applyPrivacy(row, policy) {
  if (!row) return row;
  const prefs = row.privacyPrefs || row.privacy_prefs || null;
  const out = { ...row };
  delete out.privacyPrefs; delete out.privacy_prefs;
  if (!fieldVisible('birthday', policy, prefs)) { out.dateOfBirth = null; out.date_of_birth = null; }
  if (!fieldVisible('workAnniversary', policy, prefs)) { out.joiningDate = null; out.joining_date = null; }
  if (!fieldVisible('mobileNumber', policy, prefs)) { out.phone = null; out.mobile = null; }
  return out;
}

/**
 * Who may change a profile picture. Unset means unrestricted, which is what the
 * app did before the setting existed — an admin who never opened this screen
 * must not find photo uploads silently switched off.
 */
function mayUpdatePhoto(policy, { isSelf, isAdmin }) {
  const who = policy?.profilePicture?.updatableBy;
  if (!who) return true;
  if (who === 'employee') return isSelf;
  if (who === 'admin') return isAdmin;
  return isSelf || isAdmin;   // employee_and_admin
}

module.exports = { orgPolicy, fieldVisible, applyPrivacy, mayUpdatePhoto };
