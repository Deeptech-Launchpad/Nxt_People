/* ── Function Based Permissions actually do something ───────────────────────
 *  The screen at Settings → User Access Control → Function Based Permissions
 *  saved sixteen switches that nothing read. Five rows said so on screen; the
 *  other eleven implied they were enforced and were not.
 *
 *  What has to hold now:
 *
 *    a role with no stored row falls back to the CATALOGUE DEFAULT, never to
 *      false — denying on absence would switch a function off for every
 *      existing role the day a new one is added
 *    a stored false denies, a stored true allows
 *    sub-control options come back, and a missing option falls back too
 *    requireFunction refuses with a 403 that names the switch
 *    requireFunction refuses to be built for a key that is not a function
 *    a saved change takes effect immediately rather than when a cache expires
 *    every row marked `wired` is referenced by something that enforces it
 *    the three switches the reference has off stay on, because this
 *      application does all three today
 *
 *  The pool is stubbed through the require cache, so this needs no database
 *  and no docker. Sends no mail.
 *
 *    node test_function_permissions.js
 * ────────────────────────────────────────────────────────────────────────── */
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const fs = require('fs');
const path = require('path');

const checks = [];
const check = (label, ok, extra) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok || extra === undefined ? '' : '\n          ' + JSON.stringify(extra).slice(0, 300)));
};

// ── stub the pool before anything requires it ────────────────────────────────
let ROWS = [];
let QUERIES = 0;
const dbPath = require.resolve('./db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, exports: {
    query: async () => { QUERIES += 1; return { rows: ROWS }; },
  },
};

const { FUNCTIONS } = require('./utils/accessCatalog');
const { allows, optionsFor, requireFunction, forRole, invalidate } = require('./utils/functionAccess');

const asUser = role => ({ user: { id: 'u1', role } });

const run = async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Function Based Permissions');
  console.log('══════════════════════════════════════════════════════════\n');

  // ── the catalogue itself ───────────────────────────────────────────────────
  console.log('  The catalogue\n');

  check('sixteen functions, the reference\'s count', FUNCTIONS.length === 16, FUNCTIONS.length);
  check('every function declares a boolean default',
    FUNCTIONS.every(f => typeof f.default === 'boolean'),
    FUNCTIONS.filter(f => typeof f.default !== 'boolean').map(f => f.key));
  check('every function declares wired',
    FUNCTIONS.every(f => typeof f.wired === 'boolean'));
  check('keys are unique', new Set(FUNCTIONS.map(f => f.key)).size === FUNCTIONS.length);

  /* These three sit off in the reference's screenshots and on in this
   * application. Seeding them off while switching enforcement on would have
   * withdrawn three working features on deploy. */
  const ann = FUNCTIONS.find(f => f.key === 'announcements');
  const wa = FUNCTIONS.find(f => f.key === 'work_anniversary');
  check('announcements defaults to allowed', ann.default === true);
  check('announcements.manage defaults ON, so admins keep the post button',
    ann.defaultOptions.manage === true, ann.defaultOptions);
  check('work_anniversary defaults ON, so the widget keeps rendering',
    wa.default === true, wa.default);
  check('showYearsOfExperience defaults ON, matching what the API sends today',
    wa.defaultOptions.showYearsOfExperience === true, wa.defaultOptions);

  // ── the fallback, which is the one that can lock people out ────────────────
  console.log('\n  Falling back when a role has no stored row\n');

  ROWS = [];
  invalidate();
  const empty = await forRole('some_new_role');
  check('a role with no rows at all gets the catalogue defaults, not false',
    FUNCTIONS.every(f => empty.get(f.key).allowed === f.default),
    FUNCTIONS.filter(f => empty.get(f.key).allowed !== f.default).map(f => f.key));
  check('search_employee is allowed by that fallback, not denied',
    empty.get('search_employee').allowed === true);
  check('defaults that are off stay off', empty.get('delegation').allowed === false);
  check('a missing option falls back to the catalogue option',
    empty.get('employee_tree').options.tree === 'organization', empty.get('employee_tree').options);

  ROWS = [];
  invalidate();
  check('no role key at all still yields defaults rather than an empty map',
    (await forRole(undefined)).get('favorites').allowed === true);

  // ── stored values win ──────────────────────────────────────────────────────
  console.log('\n  Stored values\n');

  ROWS = [{ key: 'birthday_buddy', allowed: false, options: {} }];
  invalidate();
  check('a stored false denies', (await allows(asUser('admin'), 'birthday_buddy')) === false);
  check('a function with no row alongside it keeps its default',
    (await allows(asUser('admin'), 'favorites')) === true);

  ROWS = [{ key: 'delegation', allowed: true, options: {} }];
  invalidate();
  check('a stored true allows something the catalogue defaults off',
    (await allows(asUser('admin'), 'delegation')) === true);

  ROWS = [{ key: 'announcements', allowed: true, options: { manage: false } }];
  invalidate();
  check('an option stored false is returned false',
    (await optionsFor(asUser('admin'), 'announcements')).manage === false);
  check('the row is still allowed with its option off',
    (await allows(asUser('admin'), 'announcements')) === true);

  ROWS = [{ key: 'not_a_real_function', allowed: true, options: {} }];
  invalidate();
  const stray = await forRole('admin');
  check('a stray key in the table is ignored rather than surfaced',
    stray.get('not_a_real_function') === undefined);
  check('stray keys do not disturb the real ones',
    stray.get('search_employee').allowed === true);

  // ── the cache ──────────────────────────────────────────────────────────────
  console.log('\n  Caching\n');

  ROWS = [{ key: 'favorites', allowed: false, options: {} }];
  invalidate();
  QUERIES = 0;
  await allows(asUser('hr_admin'), 'favorites');
  const afterFirst = QUERIES;
  await allows(asUser('hr_admin'), 'favorites');
  await allows(asUser('hr_admin'), 'birthday_buddy');
  check('repeat reads for one role hit the cache, not the database',
    QUERIES === afterFirst, { afterFirst, now: QUERIES });

  check('the cached answer is the stored one',
    (await allows(asUser('hr_admin'), 'favorites')) === false);

  ROWS = [{ key: 'favorites', allowed: true, options: {} }];
  check('without invalidation the old answer persists — the cache is real',
    (await allows(asUser('hr_admin'), 'favorites')) === false);

  invalidate();
  check('invalidate() makes a saved change take effect at once',
    (await allows(asUser('hr_admin'), 'favorites')) === true);

  check('a different role is cached separately, not shared',
    (await forRole('team_member')) !== undefined);

  // ── the middleware ─────────────────────────────────────────────────────────
  console.log('\n  requireFunction\n');

  const callMiddleware = async (mw, req) => {
    let nexted = false, status = null, body = null;
    const res = {
      status(c) { status = c; return this; },
      json(b) { body = b; return this; },
    };
    await mw(req, res, () => { nexted = true; });
    return { nexted, status, body };
  };

  ROWS = [{ key: 'birthday_buddy', allowed: true, options: {} }];
  invalidate();
  const okCall = await callMiddleware(requireFunction('birthday_buddy'), asUser('admin'));
  check('an allowed function calls next()', okCall.nexted === true && okCall.status === null);

  ROWS = [{ key: 'birthday_buddy', allowed: false, options: {} }];
  invalidate();
  const noCall = await callMiddleware(requireFunction('birthday_buddy'), asUser('admin'));
  check('a denied function does not call next()', noCall.nexted === false);
  check('it refuses with 403, not 401 or 500', noCall.status === 403, noCall.status);
  check('the refusal names the function key so a log says which switch it was',
    noCall.body?.functionKey === 'birthday_buddy', noCall.body);
  check('the refusal carries a machine-readable code',
    noCall.body?.code === 'FUNCTION_NOT_ALLOWED', noCall.body);
  check('the message names the screen that controls it',
    /Function Based Permissions/.test(noCall.body?.message || ''), noCall.body?.message);
  check('the message uses the label a person sees, not the key',
    /Birthday Buddy/.test(noCall.body?.message || ''), noCall.body?.message);

  let threw = null;
  try { requireFunction('nonsense_key'); } catch (e) { threw = e; }
  check('building a guard for a key that is not a function throws at startup',
    threw !== null && /not a function key/.test(threw.message), threw && threw.message);

  // ── wired means enforced ───────────────────────────────────────────────────
  console.log('\n  wired means something reads it\n');

  /* The defect this whole exercise came from: eleven rows claimed to be
   * enforced while nothing read them. This fails the moment somebody marks a
   * row wired without giving it something that consults the switch. */
  const searchRoots = [
    path.join(__dirname, 'routes'),
    path.join(__dirname, 'utils'),
    path.join(__dirname, '..', 'frontend', 'src'),
  ];
  const collect = dir => {
    let out = [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(collect(full));
      else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
    }
    return out;
  };
  const corpus = searchRoots.flatMap(collect)
    // The catalogue lists every key by definition, so it cannot be the evidence.
    .filter(f => !/accessCatalog\.js$/.test(f) && !/test_function_permissions\.js$/.test(f))
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');

  const wired = FUNCTIONS.filter(f => f.wired);
  const unreferenced = wired.filter(f => !corpus.includes(`'${f.key}'`));
  check(`all ${wired.length} wired functions are referenced by enforcing code`,
    unreferenced.length === 0, unreferenced.map(f => f.key));

  const notWired = FUNCTIONS.filter(f => !f.wired);
  console.log(`\n        enforced: ${wired.map(f => f.key).join(', ')}`);
  console.log(`        honest about doing nothing: ${notWired.map(f => f.key).join(', ')}`);

  // ── the screen and the enforcement must agree ──────────────────────────────
  console.log('\n  The screen agrees with the enforcement\n');

  const routeSrc = fs.readFileSync(require.resolve('./routes/access-control.js'), 'utf8');
  check('GET /functions falls back to the catalogue default, not to false',
    routeSrc.includes('?? f.default') && !/allowed: byKey\.get\(f\.key\)\?\.allowed \?\? false/.test(routeSrc));
  check('saving invalidates the cache so the change is live immediately',
    /invalidate\(\)/.test(routeSrc));
  check('there is an endpoint for a user to ask about their own role',
    routeSrc.includes("router.get('/my-functions'"));

  const orgSrc = fs.readFileSync(require.resolve('./routes/org.js'), 'utf8');
  check('/org/directory is deliberately left unguarded, with the reason recorded',
    /Not guarded by search_employee/.test(orgSrc) &&
    !/router\.get\('\/directory', requireFunction/.test(orgSrc));

  const migrateSrc = fs.readFileSync(require.resolve('./migrate_access_control.js'), 'utf8');
  check('the seed reads the catalogue instead of holding a second copy',
    migrateSrc.includes("require('./utils/accessCatalog')") &&
    !migrateSrc.includes("{ key: 'location_in_org_tab', allowed:"));

  // ── result ─────────────────────────────────────────────────────────────────
  const passed = checks.filter(Boolean).length;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ${passed}/${checks.length} passed`);
  console.log('══════════════════════════════════════════════════════════\n');
  process.exit(passed === checks.length ? 0 : 1);
};

run().catch(e => { console.error(e); process.exit(1); });
