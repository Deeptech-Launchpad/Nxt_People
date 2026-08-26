// A refused leave read must not look like a person who took no leave.
//
// Zoho answers some refusals with HTTP 200 and an error envelope that carries
// no `result` key. The reader took `response.result || []`, so the refusal
// arrived as an empty array, and the import then deleted that person's leave
// and put nothing back. That is how 43 people lost their leave once already;
// this is the same failure reached through a different door, and it was found
// on live: Alagulakshmi C, 676 working days, zero leave records, with the same
// endpoint refusing on every month tried.
//
// Nothing here touches the database, Zoho or the network.
const fs = require('fs');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

// Lifted from the script by reading it, so this cannot keep passing against a
// copy the original has since moved away from.
const src = fs.readFileSync(require.resolve('./zoho_restage.js'), 'utf8');
const from = src.indexOf('async function zohoLeave(code) {');
if (from < 0) throw new Error('zohoLeave not found in zoho_restage.js');
const body = src.slice(from, src.indexOf('\n}', from) + 2);

// zohoApi is whatever the case under test wants Zoho to have said.
const build = (answer) => new Function('zohoApi', 'patiently', `
  ${body}
  return zohoLeave;
`)(answer, fn => fn());

const ONE = { response: { result: [{ Leave: [{ Leavetype: 'Casual Leave', Daystaken: '1.0' }] }] } };

(async () => {
  console.log('\n════ A refusal is not an empty list ════\n');

  const envelopes = [
    ['message only',      { response: { message: 'Error occurred', status: 1 } }],
    ['an errors object',  { response: { errors: { code: 7031, message: 'no permission' } } }],
    ['a single error',    { response: { error: 'Error occurred' } }],
  ];
  for (const [label, answer] of envelopes) {
    let threw = null;
    try { await build(async () => answer)('ANXT230095'); }
    catch (e) { threw = e.message; }
    check(`${label} — throws rather than returning []`, threw !== null, threw);
    check(`${label} — and names the employee`, /ANXT230095/.test(threw || ''), threw);
  }

  console.log('\n════ A real answer still reads ════\n');

  const got = await build(async () => ONE)('ANXT230095');
  check('one record comes back', got.length === 1, got);
  check('and it is the record, not the wrapper',
    got[0]?.Leavetype === 'Casual Leave', got[0]);

  // Somebody who genuinely took no leave must still import as no leave —
  // guarding the refusal is worthless if it also blocks the honest zero.
  const none = await build(async () => ({ response: { result: [] } }))('ANXT230095');
  check('a genuinely empty result is still empty, not an error',
    Array.isArray(none) && none.length === 0, none);

  console.log('\n════ The shape that caused it ════\n');

  // The exact failure: an envelope with no `result` key. Before the fix this
  // returned [] and the import deleted the person's leave to write nothing.
  let deleted = false;
  try { await build(async () => ({ response: { message: 'Error occurred' } }))('X'); deleted = true; }
  catch { /* as intended */ }
  check('an envelope with no result key does NOT read as "took no leave"', !deleted);

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
