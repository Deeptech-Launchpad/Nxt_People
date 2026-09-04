/* Does this address belong to that network?
 *
 * Pure functions, no database, no server — so this runs anywhere and fast.
 *
 * The cases that matter are the ones where being wrong is invisible:
 *
 *   1. IPv4-MAPPED ADDRESSES. Node hands out ::ffff:203.0.113.7 on a
 *      dual-stack socket. If a rule written as 203.0.113.7 does not match
 *      that, every office rule silently never fires and nobody notices
 *      except that attendance stays unplaced.
 *   2. /0 IS REFUSED. "0.0.0.0/0" is the whole internet. Accepting it would
 *      mark the entire company present from anywhere on Earth.
 *   3. HOST BITS IN A NETWORK RULE. Somebody typing 203.0.113.7/24 means
 *      that /24. Matching nothing would be the least helpful reading.
 *   4. VERSIONS DO NOT CROSS. An IPv4 address must never match an IPv6 rule
 *      because their integer values happen to coincide.
 *   5. A NEIGHBOURING NETWORK IS NOT THIS ONE. Off-by-one at a prefix
 *      boundary is the classic way a fence leaks into the building next door.
 */
const { parseIP, parseRule, matches, firstMatch, cleanRules, normalize } = require('./utils/ipMatch');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 280)}`); };

console.log('\n=== IP matching ===\n');

console.log('Parsing');
check('a dotted quad parses', parseIP('203.0.113.7')?.version === 4);
check('an IPv6 address parses', parseIP('2401:4900:1c80::1')?.version === 6);
check('an IPv4-mapped address becomes IPv4', parseIP('::ffff:203.0.113.7')?.version === 4);
check('a zone index is stripped', parseIP('fe80::1%eth0')?.version === 6);
check('brackets are stripped', parseIP('[2401:4900::1]')?.version === 6);
check('an octet over 255 is refused', parseIP('203.0.113.256') === null, parseIP('203.0.113.256'));
check('three octets are refused', parseIP('203.0.113') === null);
check('nonsense is refused', parseIP('office-wifi') === null);
check('an empty string is refused', parseIP('') === null);
check('a non-string is refused', parseIP(null) === null);
check('normalize keeps a plain address', normalize('10.0.0.1') === '10.0.0.1');

console.log('\nRules');
check('a bare address becomes a /32', parseRule('203.0.113.7')?.prefix === 32);
check('a bare IPv6 becomes a /128', parseRule('2401:4900::1')?.prefix === 128);
check('a /24 is read as a /24', parseRule('203.0.113.0/24')?.prefix === 24);
check('/0 is refused — it is the whole internet', parseRule('0.0.0.0/0') === null, parseRule('0.0.0.0/0'));
check('::/0 is refused too', parseRule('::/0') === null);
check('/33 is refused on IPv4', parseRule('203.0.113.0/33') === null);
check('/129 is refused on IPv6', parseRule('2401:4900::/129') === null);
check('a non-numeric prefix is refused', parseRule('203.0.113.0/abc') === null);
check('host bits are masked away', parseRule('203.0.113.7/24')?.text === '203.0.113.7/24'
  && parseRule('203.0.113.7/24')?.base === parseRule('203.0.113.0/24')?.base);

console.log('\nMatching, IPv4');
check('an address matches itself', matches('203.0.113.7', '203.0.113.7'));
check('a different address does not', !matches('203.0.113.8', '203.0.113.7'));
check('inside a /24 matches', matches('203.0.113.200', '203.0.113.0/24'));
check('outside a /24 does not', !matches('203.0.114.1', '203.0.113.0/24'));
check('the network address itself matches', matches('203.0.113.0', '203.0.113.0/24'));
check('the broadcast address matches', matches('203.0.113.255', '203.0.113.0/24'));
check('one below the range does not', !matches('203.0.112.255', '203.0.113.0/24'));
check('one above the range does not', !matches('203.0.114.0', '203.0.113.0/24'));
check('a /16 covers the /24 inside it', matches('203.0.113.7', '203.0.0.0/16'));
check('a private /8 works', matches('10.42.7.9', '10.0.0.0/8'));
check('a different private block does not', !matches('192.168.1.1', '10.0.0.0/8'));

console.log('\nMatching, the mapped form that Node actually hands us');
check('mapped address against a plain rule', matches('::ffff:203.0.113.7', '203.0.113.7'));
check('mapped address against a /24 rule', matches('::ffff:203.0.113.200', '203.0.113.0/24'));
check('mapped address outside the /24', !matches('::ffff:203.0.114.1', '203.0.113.0/24'));

console.log('\nMatching, IPv6');
check('inside a /32 matches', matches('2401:4900:1c80::5', '2401:4900::/32'));
check('outside a /32 does not', !matches('2402:4900:1c80::5', '2401:4900::/32'));
check('compressed and expanded are the same address',
  matches('2401:0000:0000:0000:0000:0000:0000:0001', '2401::1'));
check('a trailing dotted quad parses', parseIP('::ffff:0:203.0.113.7')?.version === 6);

console.log('\nVersions do not cross');
check('IPv4 does not match an IPv6 rule', !matches('203.0.113.7', '2401:4900::/32'));
check('IPv6 does not match an IPv4 rule', !matches('2401:4900::1', '203.0.113.0/24'));

console.log('\nfirstMatch names the network that placed somebody');
check('returns the matching rule', firstMatch('10.0.0.5', ['203.0.113.0/24', '10.0.0.0/8']) === '10.0.0.0/8');
check('returns null when nothing matches', firstMatch('8.8.8.8', ['203.0.113.0/24', '10.0.0.0/8']) === null);
check('skips a malformed rule rather than throwing',
  firstMatch('10.0.0.5', ['not-an-ip', '10.0.0.0/8']) === '10.0.0.0/8');
check('an empty list matches nothing', firstMatch('10.0.0.5', []) === null);
check('a non-array matches nothing', firstMatch('10.0.0.5', null) === null);
check('an unparseable address matches nothing', firstMatch('office', ['10.0.0.0/8']) === null);

console.log('\ncleanRules, what the settings screen will accept');
check('empty input gives an empty list', cleanRules('').length === 0);
check('null gives an empty list', cleanRules(null).length === 0);
check('a comma-separated string splits', cleanRules('10.0.0.0/8, 203.0.113.7').length === 2);
check('newlines split too', cleanRules('10.0.0.0/8\n203.0.113.7').length === 2);
check('blank entries are dropped', cleanRules('10.0.0.0/8,,  ,203.0.113.7').length === 2);
check('duplicates are dropped', cleanRules(['10.0.0.0/8', '10.0.0.0/8']).length === 1);
let threw = null;
try { cleanRules('10.0.0.0/8, banana'); } catch (e) { threw = e.message; }
check('a bad entry throws and names itself', !!threw && threw.includes('banana'), threw);
threw = null;
try { cleanRules('0.0.0.0/0'); } catch (e) { threw = e.message; }
check('the whole internet is refused with a message', !!threw, threw);

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} passed\n`);
process.exit(passed === checks.length ? 0 : 1);
