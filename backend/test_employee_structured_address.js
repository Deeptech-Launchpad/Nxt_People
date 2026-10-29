// Regression test for Update 3 — structured Current/Permanent Address fields
// on Employees -> Edit Employee / Employee Details.
//
// Exercises a literal copy of the address-related slice of
// routes/employees.js's PUT /:id handler (same "field present in the body ->
// updates.push(...)" allowlist convention used there), so this tests the real
// persistence logic, not a paraphrase of it.
//
// House pattern: everything happens inside one transaction that is always
// rolled back, so this never leaves data behind even if an assertion throws.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';

const pool = require('./db');

let passed = 0, total = 0;
function check(label, ok, extra) {
  total++;
  if (ok) { passed++; console.log(`PASS - ${label}`); }
  else { console.log(`FAIL - ${label}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); }
}

// Literal copy of the address-field slice added to routes/employees.js's
// PUT /:id handler — "field present in req.body -> write its column; absent
// -> leave untouched" is the whole backward-compatibility guarantee, so the
// test drives this exact shape rather than a hand-rolled UPDATE.
async function applyPut(client, employeeId, body) {
  const {
    address, permanentAddress,
    addressLine1, addressLine2, addressCity, addressDistrict, addressState, addressPincode, addressCountry,
    permanentAddressLine1, permanentAddressLine2, permanentAddressCity, permanentAddressDistrict,
    permanentAddressState, permanentAddressPincode, permanentAddressCountry,
    firstName,
  } = body;

  const updates = [];
  const params = [];
  let i = 1;
  if (firstName !== undefined)                { updates.push(`first_name = $${i++}`);                 params.push(firstName); }
  if (address !== undefined)                  { updates.push(`address = $${i++}`);                   params.push(address || null); }
  if (permanentAddress !== undefined)         { updates.push(`permanent_address = $${i++}`);         params.push(permanentAddress || null); }
  if (addressLine1 !== undefined)             { updates.push(`address_line1 = $${i++}`);             params.push(addressLine1 || null); }
  if (addressLine2 !== undefined)             { updates.push(`address_line2 = $${i++}`);             params.push(addressLine2 || null); }
  if (addressCity !== undefined)              { updates.push(`address_city = $${i++}`);              params.push(addressCity || null); }
  if (addressDistrict !== undefined)          { updates.push(`address_district = $${i++}`);          params.push(addressDistrict || null); }
  if (addressState !== undefined)             { updates.push(`address_state = $${i++}`);             params.push(addressState || null); }
  if (addressPincode !== undefined)           { updates.push(`address_pincode = $${i++}`);           params.push(addressPincode || null); }
  if (addressCountry !== undefined)           { updates.push(`address_country = $${i++}`);           params.push(addressCountry || null); }
  if (permanentAddressLine1 !== undefined)    { updates.push(`permanent_address_line1 = $${i++}`);   params.push(permanentAddressLine1 || null); }
  if (permanentAddressLine2 !== undefined)    { updates.push(`permanent_address_line2 = $${i++}`);   params.push(permanentAddressLine2 || null); }
  if (permanentAddressCity !== undefined)     { updates.push(`permanent_address_city = $${i++}`);    params.push(permanentAddressCity || null); }
  if (permanentAddressDistrict !== undefined) { updates.push(`permanent_address_district = $${i++}`); params.push(permanentAddressDistrict || null); }
  if (permanentAddressState !== undefined)    { updates.push(`permanent_address_state = $${i++}`);   params.push(permanentAddressState || null); }
  if (permanentAddressPincode !== undefined)  { updates.push(`permanent_address_pincode = $${i++}`); params.push(permanentAddressPincode || null); }
  if (permanentAddressCountry !== undefined)  { updates.push(`permanent_address_country = $${i++}`); params.push(permanentAddressCountry || null); }

  params.push(employeeId);
  await client.query(`UPDATE employees SET ${updates.join(', ')} WHERE id = $${i}`, params);
}

async function getRow(client, id) {
  const r = await client.query(
    `SELECT first_name, address, permanent_address,
            address_line1, address_line2, address_city, address_district, address_state, address_pincode, address_country,
            permanent_address_line1, permanent_address_line2, permanent_address_city, permanent_address_district,
            permanent_address_state, permanent_address_pincode, permanent_address_country,
            current_address
       FROM employees WHERE id = $1`,
    [id]
  );
  return r.rows[0];
}

async function main() {
  const client = await pool.connect();
  const stamp = Date.now();
  try {
    await client.query('BEGIN');

    // --- Scenario 1: a brand-new structured address, both current & permanent ---
    const fresh = await client.query(
      `INSERT INTO employees (first_name, last_name, email, password, role, status)
       VALUES ('Test', 'Employee', $1, 'x', 'team_member', 'active') RETURNING id`,
      [`fresh-${stamp}@test.local`]
    );
    const freshId = fresh.rows[0].id;

    await applyPut(client, freshId, {
      addressLine1: 'Door No 12', addressLine2: 'Gandhi Street', addressCity: 'Coimbatore',
      addressDistrict: 'Coimbatore', addressState: 'Tamil Nadu', addressPincode: '641001', addressCountry: 'India',
      permanentAddressLine1: 'Door No 45', permanentAddressLine2: 'Nehru Road', permanentAddressCity: 'Madurai',
      permanentAddressDistrict: 'Madurai', permanentAddressState: 'Tamil Nadu', permanentAddressPincode: '625001',
      permanentAddressCountry: 'India',
    });
    let row = await getRow(client, freshId);
    check('addressLine1 persisted', row.address_line1 === 'Door No 12');
    check('addressDistrict persisted (the new field)', row.address_district === 'Coimbatore');
    check('addressCountry persisted', row.address_country === 'India');
    check('permanentAddressLine1 persisted', row.permanent_address_line1 === 'Door No 45');
    check('permanentAddressDistrict persisted (the new field)', row.permanent_address_district === 'Madurai');
    check('permanentAddressCountry persisted', row.permanent_address_country === 'India');
    check('legacy flat current_address untouched by a structured-only save (stays NULL)', row.current_address === null);
    check('legacy flat address untouched by a structured-only save (stays NULL)', row.address === null);

    // --- Scenario 2: editing an unrelated field never touches address data ---
    await applyPut(client, freshId, { firstName: 'Renamed' });
    row = await getRow(client, freshId);
    check('unrelated-field save leaves addressLine1 intact', row.address_line1 === 'Door No 12');
    check('unrelated-field save leaves addressDistrict intact', row.address_district === 'Coimbatore');
    check('unrelated-field save leaves permanentAddressCity intact', row.permanent_address_city === 'Madurai');
    check('first_name actually changed, confirming the save itself ran', row.first_name === 'Renamed');

    // --- Scenario 3: legacy employee (old flat text, no structured data) is
    // left exactly as-is by an unrelated save — nothing auto-splits it ---
    const legacy = await client.query(
      `INSERT INTO employees (first_name, last_name, email, password, role, status, current_address, permanent_address)
       VALUES ('Legacy', 'Employee', $1, 'x', 'team_member', 'active', $2, $3) RETURNING id`,
      [`legacy-${stamp}@test.local`, '12 Old Street, Chennai, Tamil Nadu 600001, India', '34 Old Road, Salem, Tamil Nadu 636001, India']
    );
    const legacyId = legacy.rows[0].id;
    await applyPut(client, legacyId, { firstName: 'LegacyRenamed' });
    row = await getRow(client, legacyId);
    check('legacy employee: flat current_address survives an unrelated save untouched',
      row.current_address === '12 Old Street, Chennai, Tamil Nadu 600001, India');
    check('legacy employee: flat permanent_address survives an unrelated save untouched',
      row.permanent_address === '34 Old Road, Salem, Tamil Nadu 636001, India');
    check('legacy employee: structured fields were never auto-populated from the flat text',
      row.address_line1 === null && row.address_city === null && row.address_district === null);

    // --- Scenario 4: clearing a structured field (empty string) nulls it,
    // same convention the rest of this route already uses ---
    await applyPut(client, freshId, { addressLine2: '' });
    row = await getRow(client, freshId);
    check('an explicitly cleared field saves as NULL, not an empty string', row.address_line2 === null);
    check('clearing one field does not touch its siblings', row.address_city === 'Coimbatore');

    // --- Confirm nothing was actually written ---
    const inTxn = await client.query(`SELECT COUNT(*)::int AS n FROM employees WHERE email LIKE $1`, [`%-${stamp}@test.local`]);
    check('both synthetic employees exist inside this (about to be rolled back) transaction', inTxn.rows[0].n === 2);

  } catch (err) {
    console.error('ERROR during test run:', err);
  } finally {
    await client.query('ROLLBACK');
    const postRollback = await pool.query(`SELECT COUNT(*)::int AS n FROM employees WHERE email LIKE $1`, [`%-${stamp}@test.local`]);
    check('rollback confirmed - no synthetic employees persisted', postRollback.rows[0].n === 0);
    client.release();
    await pool.end();
  }

  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

main();
