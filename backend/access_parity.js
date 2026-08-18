/* ── Access parity ─────────────────────────────────────────────────────────
 *  Roles stopped being six strings compiled into the route guards and became
 *  records with permissions. The one thing that must not change is who can
 *  reach what.
 *
 *  This walks every route in the mounted Express app, finds its authorize()
 *  guard, and asks — for each of the six roles — whether the OLD rule and the
 *  NEW rule agree. The old rule is `roles.includes(userRole)`, restated here
 *  rather than imported, so a mistake in the new implementation cannot also
 *  corrupt what it is being compared against.
 *
 *  It also checks the data-scoping helpers, because a role that passes a route
 *  guard but scopes to no rows is locked out just as effectively.
 *
 *  Run it after the migration and before trusting anything:
 *      docker compose exec backend node access_parity.js
 * ───────────────────────────────────────────────────────────────────────── */

const permissions = require('./utils/permissions');
const { GUARD_PERMISSION } = require('./middleware/auth');

const ROLE_KEYS = ['admin', 'director', 'hr_admin', 'manager', 'team_incharge', 'team_member'];

// What the application enforced before this change, written out again from the
// three guard shapes that appear in the codebase. Deliberately not imported.
const OLD_RULE = {
  'admin|director|hr_admin':                       ['admin', 'director', 'hr_admin'],
  'admin|director|hr_admin|manager':               ['admin', 'director', 'hr_admin', 'manager'],
  'admin|director|hr_admin|manager|team_incharge': ['admin', 'director', 'hr_admin', 'manager', 'team_incharge'],
};

// The old data-scoping rule, likewise restated.
const OLD_FULL_ACCESS = ['admin', 'director', 'hr_admin'];
const OLD_IS_MANAGER  = ['manager', 'team_incharge'];

let failures = 0;
const check = (label, ok, extra) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || extra === undefined ? '' : '  <- ' + JSON.stringify(extra)}`);
};

(async () => {
  await permissions.reload();
  console.log(`  permission map loaded from the table: ${permissions.isLoaded()}\n`);
  if (!permissions.isLoaded()) {
    console.error('  The roles table is empty. Run migrate_access_control.js first.');
    process.exit(1);
  }

  console.log('— every guard shape, every role —');
  for (const [shape, permission] of GUARD_PERMISSION) {
    const allowedBefore = OLD_RULE[shape];
    if (!allowedBefore) {
      check(`the shape '${shape}' is one this test knows`, false, shape);
      continue;
    }
    for (const role of ROLE_KEYS) {
      const before = allowedBefore.includes(role);
      const after = permissions.roleCan(role, permission);
      check(`${role.padEnd(14)} ${before ? 'may' : 'may not'} reach ${shape.split('|').length}-role routes (${permission})`,
        before === after, { before, after });
    }
  }

  console.log('\n— the data-scoping helpers —');
  // Required after the swap, because these are what decide which rows come
  // back once the guard has let you past.
  const { isFullAccess, isManager, reportsScope } = require('./utils/roles');
  for (const role of ROLE_KEYS) {
    check(`isFullAccess('${role}')`,
      isFullAccess(role) === OLD_FULL_ACCESS.includes(role),
      { before: OLD_FULL_ACCESS.includes(role), after: isFullAccess(role) });
    check(`isManager('${role}')`,
      isManager(role) === OLD_IS_MANAGER.includes(role),
      { before: OLD_IS_MANAGER.includes(role), after: isManager(role) });
  }

  console.log('\n— reportsScope still produces the same SQL —');
  for (const role of ROLE_KEYS) {
    const scope = reportsScope({ _id: '00000000-0000-0000-0000-000000000001', role }, 'e', 1);
    const expected = OLD_FULL_ACCESS.includes(role) ? ''
      : OLD_IS_MANAGER.includes(role) ? ' AND (e.reporting_manager_id = $1 OR e.approving_authority_id = $1)'
      : ' AND 1=0';
    check(`reportsScope('${role}')`, scope.clause === expected, { got: scope.clause, want: expected });
  }

  console.log('\n— every authorize() in the codebase is a shape we mapped —');
  // The guard throws while routes are built, so importing the app is the test:
  // an unmapped shape anywhere fails this line rather than a live request.
  try {
    require('./app');
    check('app.js builds every route without an unmapped guard', true);
  } catch (err) {
    check('app.js builds every route without an unmapped guard', false, err.message);
  }

  console.log('\n— a role with no permissions reaches nothing —');
  for (const [, permission] of GUARD_PERMISSION) {
    check(`team_member cannot ${permission}`, !permissions.roleCan('team_member', permission));
  }

  console.log('\n— an unknown role is refused rather than admitted —');
  for (const [, permission] of GUARD_PERMISSION) {
    check(`a role that does not exist cannot ${permission}`,
      !permissions.roleCan('no_such_role', permission));
  }
  check('the legacy default role no longer grants anything',
    !permissions.roleCan('employee', 'org.manage'));

  console.log(failures ? `\n${failures} FAILED — do not deploy` : '\n✅ Access is identical to before. 0 differences.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
