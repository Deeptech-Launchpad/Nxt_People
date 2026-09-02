/**
 * Employee ID generation — shared helpers used by routes/employees.js
 * (manual Add Employee) and routes/registrations.js (Confirm Registration).
 *
 * Each company has its OWN id format, matched to existing Zoho-imported data:
 *
 *   AltiusNxt         →  ANXT{YY}{NNNNN}   (year 2-digit + 5-digit seq)
 *                        ANXT220005, ANXT2600150 …
 *   DTLP              →  dtlp-{NNN}        (lowercase, hyphen, 3-digit seq)
 *                        dtlp-001, dtlp-014 …
 *   Altius Technology →  ATL{NNN}          (3-digit seq)
 *                        ATL001, ATL042 …
 *
 * Each company has its own counter. The next ID is computed by scanning
 * existing rows that match the company's regex, taking MAX(sequence) + 1.
 * For AltiusNxt the sequence is reset per joining year (the YY in the ID).
 *
 * Defaults to AltiusNxt's format when no company is supplied.
 *
 * To add a new company, append an entry to GENERATORS below.
 */

function yy() {
  return String(new Date().getFullYear()).slice(-2);
}

const GENERATORS = {
  'AltiusNxt': async (pool) => {
    const year = yy();
    // ANXT + YY + 5-digit sequence, sequence resets per year.
    // SUBSTRING FROM 7 skips "ANXT" + 2-digit year → just the sequence digits.
    const r = await pool.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(employee_id FROM 7) AS INTEGER)), 0) + 1 AS next
         FROM employees
        WHERE employee_id ~ ('^ANXT' || $1 || '[0-9]{5}$')`,
      [year]
    );
    return `ANXT${year}${String(r.rows[0].next).padStart(5, '0')}`;
  },

  'DTLP': async (pool) => {
    // dtlp- + 3-digit sequence, all-time counter (no year segment).
    // SUBSTRING FROM 6 skips "dtlp-" → just the digits.
    const r = await pool.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(employee_id FROM 6) AS INTEGER)), 0) + 1 AS next
         FROM employees
        WHERE employee_id ~ '^dtlp-[0-9]+$'`
    );
    return `dtlp-${String(r.rows[0].next).padStart(3, '0')}`;
  },

  'Altius Technology': async (pool) => {
    // ATL + 3-digit sequence, all-time counter.
    // SUBSTRING FROM 4 skips "ATL" → just the digits.
    const r = await pool.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(employee_id FROM 4) AS INTEGER)), 0) + 1 AS next
         FROM employees
        WHERE employee_id ~ '^ATL[0-9]+$'`
    );
    return `ATL${String(r.rows[0].next).padStart(3, '0')}`;
  },
};

const DEFAULT_COMPANY = 'AltiusNxt';
const COMPANIES = Object.keys(GENERATORS);

/* Settings -> Employee Information -> Policy -> Employee ID can replace the
 * built-in generators with a configured rule: prefix segments, a zero-padded
 * counter, suffix segments. The hard-coded generators remain the fallback, so
 * an organisation that never opens that screen keeps exactly what it had.
 *
 * The counter is claimed with UPDATE ... RETURNING inside the same statement
 * that reads it — two people adding an employee at once must not be handed
 * the same ID. */
async function nextIdFromRule(pool, ctx = {}) {
  const cfg = await pool.query(`SELECT employee_info_config AS c FROM settings LIMIT 1`).catch(() => ({ rows: [] }));
  if (!cfg.rows[0]?.c?.idGeneration?.enabled) return null;

  const r = await pool.query(
    `SELECT * FROM employee_id_rules WHERE is_active ORDER BY is_default DESC, name LIMIT 1`)
    .catch(() => ({ rows: [] }));
  const rule = r.rows[0];
  if (!rule) return null;

  const { renderRule } = require('../routes/employee-info-settings');
  // The combination the counter belongs to. With reuse off there is one
  // counter for the whole rule, so the key is empty.
  const combination = rule.reuse_per_combination
    ? renderRule({ ...rule, placeholder_digits: 1 }, '', ctx).replace(/\d+$/, '')
    : '';

  const claimed = await pool.query(
    `INSERT INTO employee_id_counters (rule_id, combination, next_number)
     VALUES ($1, $2, $3)
     ON CONFLICT (rule_id, combination)
     DO UPDATE SET next_number = employee_id_counters.next_number + 1, updated_at = NOW()
     RETURNING next_number`,
    [rule.id, combination, Math.max(0, rule.starting_number || 1)]);

  const id = renderRule(rule, claimed.rows[0].next_number, ctx);
  await pool.query(`UPDATE employee_id_rules SET last_generated_id = $1 WHERE id = $2`, [id, rule.id])
    .catch(() => {});
  return id;
}

async function nextIdForCompany(pool, company, ctx = {}) {
  const fromRule = await nextIdFromRule(pool, ctx).catch(() => null);
  if (fromRule) return fromRule;
  const gen = GENERATORS[(company || '').trim()] || GENERATORS[DEFAULT_COMPANY];
  return gen(pool);
}

module.exports = {
  COMPANIES,
  DEFAULT_COMPANY,
  nextIdForCompany,
  nextIdFromRule,
};
