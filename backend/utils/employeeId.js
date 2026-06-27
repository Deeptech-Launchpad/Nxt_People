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

async function nextIdForCompany(pool, company) {
  const gen = GENERATORS[(company || '').trim()] || GENERATORS[DEFAULT_COMPANY];
  return gen(pool);
}

module.exports = {
  COMPANIES,
  DEFAULT_COMPANY,
  nextIdForCompany,
};
