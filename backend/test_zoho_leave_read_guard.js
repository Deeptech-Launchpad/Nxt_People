// A zero must come from a read that worked.
//
// Zoho answers a per-person leave search with HTTP 200 and an error envelope
// carrying no `result` key — and it does this BOTH for a real refusal and for
// a search that simply matched nothing. The two are indistinguishable from the
// answer alone, so neither guess is safe:
//
//   guess "empty"    a failed read wipes somebody's leave. That is how 43
//                    people lost theirs once already.
//   guess "failed"   the thirteen people on live who genuinely took no leave
//                    can never be imported at all.
//
// So the reader decides nothing here. It falls back to reading the whole leave
// form unfiltered, which either produces the person's records or proves there
// are none. On live that sweep reached all 6,213 records and confirmed those
// thirteen hold zero — Alagulakshmi C among them, 676 working days and no
// leave, which turned out to be true.
//
// Nothing here touches the database, Zoho or the network.
const fs = require('fs');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

// Lifted from the script by reading it, so this cannot keep passing against a
// copy the original has since moved away from.
const src = fs.readFileSync(require.resolve('./zoho_restage.js'), 'utf8');
const lift = (what, start, end) => {
  const from = src.indexOf(start);
  if (from < 0) throw new Error(`${what} not found in zoho_restage.js`);
  return src.slice(from, src.indexOf(end, from) + end.length);
};

const envelope = lift('leaveEnvelope', 'const leaveEnvelope = (json) => {', '\n};');
const sweep = lift('zohoLeaveSweep', 'let sweepCache = null;', '\n}');
const body = lift('zohoLeave', 'async function zohoLeave(code) {', '\n}');

// zohoApi is whatever the case under test wants Zoho to have said. Each build
// gets its own scope, so the sweep cache cannot leak between cases.
const build = (answer) => new Function('zohoApi', 'patiently', `
  ${envelope}
  ${sweep}
  ${body}
  return zohoLeave;
`)(answer, fn => fn());

// Zoho refusing the per-person search while the unfiltered read answers.
const respondBy = (records) => async (url) => {
  if (url.includes('searchParams')) return { response: { message: 'Error occurred', status: 1 } };
  if (!/sIndex=1&/.test(url)) return { response: { result: [] } };
  return { response: { result: records } };
};

const wrap = (code, type, days) => ({
  Leave: [{ Employee_ID: `Someone ${code}`, Leavetype: type, Daystaken: days }],
});
const ONE = { response: { result: [{ Leave: [{ Leavetype: 'Casual Leave', Daystaken: '1.0' }] }] } };

(async () => {
  console.log('\n════ A refusal is not an empty list ════\n');

  // The search refuses; the sweep holds two records for this person and one
  // for somebody else. The refusal must not become an empty answer.
  const swept = await build(respondBy([
    wrap('ANXT230095', 'Casual Leave', '1.0'),
    wrap('ANXT230095', 'Permission', '2.0'),
    wrap('ANXT220001', 'Casual Leave', '1.0'),
  ]))('ANXT230095');
  check('a refused search falls back to the sweep', swept.length === 2, swept);
  check('and takes only this person\'s records',
    swept.every(r => /ANXT230095/.test(r.Employee_ID)), swept);

  // The live case: search refuses, sweep succeeds, and the person really does
  // hold nothing. That zero is believable because a read produced it.
  const honest = await build(respondBy([wrap('ANXT220001', 'Casual Leave', '1.0')]))('ANXT230095');
  check('a sweep that finds none means none — this is the honest zero',
    Array.isArray(honest) && honest.length === 0, honest);

  // But if the sweep cannot be read either, nothing is known and nothing may
  // be assumed. This is the case that must still stop the import.
  let threw = null;
  try { await build(async () => ({ response: { message: 'Error occurred' } }))('ANXT230095'); }
  catch (e) { threw = e.message; }
  check('when the sweep is refused too, it throws rather than returning []',
    threw !== null, threw);
  check('and says it was the unfiltered read that failed',
    /unfiltered/.test(threw || ''), threw);

  console.log('\n════ A real answer still reads ════\n');

  const got = await build(async () => ONE)('ANXT230095');
  check('one record comes back', got.length === 1, got);
  check('and it is the record, not the wrapper',
    got[0]?.Leavetype === 'Casual Leave', got[0]);

  const none = await build(async () => ({ response: { result: [] } }))('ANXT230095');
  check('a search answering with an empty result is empty, no sweep needed',
    Array.isArray(none) && none.length === 0, none);

  console.log('\n════ The envelope itself ════\n');

  const env = new Function(`${envelope} return leaveEnvelope;`)();
  check('a message-only envelope is not an answer',
    env({ response: { message: 'Error occurred' } }) !== null);
  check('an errors object is not an answer',
    env({ response: { errors: { code: 7031 } } }) !== null);
  check('a result — even an empty one — IS an answer',
    env({ response: { result: [] } }) === null);
  check('and nothing at all is not an answer either',
    env(undefined) !== null);

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
