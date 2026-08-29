/* ── Which pages are broken, and why ───────────────────────────────────────
 *  "An internal server error occurred" is deliberately opaque to the browser —
 *  the detail goes to the log instead. That is right for a stranger and slow
 *  for us: finding a broken screen means clicking it, then hunting the log.
 *
 *  This walks every GET route the application registers, calls each one as an
 *  administrator, and prints the ones that fail together with the real reason.
 *  It is how you find out that four pages are broken by the same missing
 *  column without clicking through forty screens.
 *
 *  Read-only and safe on production:
 *    · GET only. POST, PUT, PATCH and DELETE are never called.
 *    · Mail is disabled before anything loads.
 *    · Routes taking an :id are listed but not called — a made-up id proves
 *      nothing, and a real one would mean reading somebody's record to find it.
 *
 *  Why it runs the app in-process rather than curling the live port: it can
 *  then read the error object the handler produced, rather than the sentence
 *  the browser is given.
 *
 *    docker compose exec backend node check_routes.js
 *    docker compose exec backend node check_routes.js --all      (include :id routes)
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('check_routes.js does not send mail'); },
  verify: async () => { throw new Error('check_routes.js does not send mail'); },
});

const jwt = require('jsonwebtoken');
const pool = require('./db');

const INCLUDE_PARAMS = process.argv.includes('--all');
const pad = (s, n) => String(s ?? '').padEnd(n);

/* Capture what the handlers log. serverError writes the real message and stack
 * there and gives the caller a fixed sentence, so this is the only place the
 * cause is visible. */
const captured = new Map();
const logger = require('./logger');
const origError = logger.error.bind(logger);
let currentRoute = null;
logger.error = (obj, msg) => {
  if (currentRoute && obj && (obj.err || obj.message)) {
    captured.set(currentRoute, obj.err || obj.message);
  }
  return origError(obj, msg);
};

/** Every GET path the app registers, read off the Express router stack. */
function collectRoutes(app) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const path = prefix + layer.route.path;
        for (const m of Object.keys(layer.route.methods)) {
          if (m === 'get') out.push(path);
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        // Recover the mount path from the layer's regexp — Express does not
        // keep it anywhere friendlier.
        let mount = '';
        const src = layer.regexp?.source || '';
        const m = /^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)/.exec(src);
        if (m) mount = '/' + m[1].replace(/\\\//g, '/');
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk(app._router?.stack, '');
  return [...new Set(out)];
}

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Route health — every GET, called as an administrator');
  console.log('══════════════════════════════════════════════════════════\n');

  const admin = (await pool.query(
    `SELECT id, email, role FROM employees
      WHERE role IN ('admin','director') AND status = 'active' AND deleted_at IS NULL
      ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END LIMIT 1`)).rows[0];

  if (!admin) {
    console.log('  No active admin or director to test as.\n');
    await pool.end();
    return;
  }
  if (!process.env.JWT_SECRET) {
    console.log('  JWT_SECRET is not set in this environment.\n');
    await pool.end();
    return;
  }

  console.log(`  Testing as ${admin.email} (${admin.role})\n`);
  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

  const app = require('./app');
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const all = collectRoutes(app).filter(p => p.startsWith('/api/')).sort();
  const plain = all.filter(p => !p.includes(':'));
  const withParams = all.filter(p => p.includes(':'));
  const toCall = INCLUDE_PARAMS ? all : plain;

  console.log(`  ${all.length} GET route(s): ${plain.length} without an :id, ${withParams.length} with one`);
  console.log(`  Calling ${toCall.length}${INCLUDE_PARAMS ? '' : ' — pass --all to include :id routes'}\n`);

  const broken = [];
  const denied = [];
  let ok = 0;

  for (const path of toCall) {
    currentRoute = path;
    let status = 0;
    let body = '';
    try {
      const r = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
      status = r.status;
      body = (await r.text()).slice(0, 200);
    } catch (e) {
      status = -1;
      body = e.message;
    }
    currentRoute = null;

    if (status >= 500 || status === -1) {
      broken.push({ path, status, why: captured.get(path) || body });
      process.stdout.write('x');
    } else if (status === 403 || status === 401) {
      denied.push({ path, status });
      process.stdout.write('.');
    } else {
      ok += 1;
      process.stdout.write('.');
    }
  }

  server.close();
  console.log('\n');

  if (broken.length) {
    console.log(`  ${broken.length} BROKEN\n`);
    /* Grouped by cause, because these usually share one. Four pages failing on
     * the same missing column is one fix, not four. */
    const byCause = new Map();
    for (const b of broken) {
      const key = String(b.why || 'unknown').slice(0, 120);
      if (!byCause.has(key)) byCause.set(key, []);
      byCause.get(key).push(b.path);
    }
    for (const [why, paths] of byCause) {
      console.log(`    ${why}`);
      for (const p of paths) console.log(`      ${p}`);
      console.log('');
    }
  } else {
    console.log('  Nothing returned a 500.\n');
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${ok} ok · ${denied.length} refused by permission · ${broken.length} broken`);
  if (denied.length) {
    console.log(`  (refused is not a fault — this role simply may not see those)`);
  }
  if (!INCLUDE_PARAMS && withParams.length) {
    console.log(`  ${withParams.length} route(s) taking an :id were not called.`);
  }
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
  process.exit(broken.length ? 1 : 0);
})().catch(async e => {
  console.error('\n  check_routes.js failed —', e.message, '\n');
  try { await pool.end(); } catch {}
  process.exit(1);
});
