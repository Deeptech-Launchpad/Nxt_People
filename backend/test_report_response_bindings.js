/* ── A report that builds every row and then cannot say so ──────────────────
 *  /reports/attendance/early-late returned "An internal server error occurred"
 *  on every load. Nothing was wrong with the data: it queried, classified and
 *  assembled every row correctly, and then threw on the LAST line of the try —
 *
 *      res.json({ success: true, data, ..., deviationTracked });
 *
 *  because `deviationTracked` was only ever declared inside a DIFFERENT route
 *  handler, eight hundred lines further down. Out of scope, so a ReferenceError,
 *  which the catch turned into a bare 500 with no log line anywhere.
 *
 *  node --check cannot see this — the file parses perfectly, and the reference
 *  only throws when that handler runs. So this checks the thing a parser will
 *  not: every name a route hands to res.json is bound where it is used.
 *
 *  It reads the file. It opens no connection, runs no query, sends no mail.
 * ────────────────────────────────────────────────────────────────────────── */
const fs = require('fs');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 400)}`); };

const FILES = ['./routes/reports.js'];

/** Split a route file into its handler blocks, so scope can be reasoned about. */
function handlersOf(lines) {
  const starts = [];
  lines.forEach((l, i) => { if (/^router\.(get|post|put|patch|delete)\(/.test(l)) starts.push(i); });
  return starts.map((s, k) => ({
    from: s + 1,
    to: starts[k + 1] || lines.length,
    name: (lines[s].match(/'([^']+)'/) || [])[1] || `line ${s + 1}`,
  }));
}

/** Names bound at module level — imports, helpers, constants. */
function moduleScope(lines) {
  const names = new Set();
  for (const l of lines) {
    let m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (m) names.add(m[1]);
    m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) names.add(m[1]);
    // Destructured requires: const { a, b } = require(...)
    m = l.match(/^(?:const|let|var)\s*\{([^}]+)\}\s*=/);
    if (m) m[1].split(',').forEach(p => {
      const n = p.split(':').pop().trim().split('=')[0].trim();
      if (n) names.add(n);
    });
  }
  return names;
}

for (const file of FILES) {
  const src = fs.readFileSync(require.resolve(file), 'utf8');
  const lines = src.split('\n');
  const handlers = handlersOf(lines);
  const modScope = moduleScope(lines);

  console.log(`\n════ ${file} — ${handlers.length} handlers ════\n`);

  let shorthandsChecked = 0;
  const offenders = [];

  for (const h of handlers) {
    const body = lines.slice(h.from - 1, h.to).join('\n');

    // Names this handler binds itself: declarations, destructuring, params.
    const bound = new Set(modScope);
    for (const m of body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) bound.add(m[1]);
    for (const m of body.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) {
      m[1].split(',').forEach(p => {
        const n = p.split(':').pop().trim().split('=')[0].trim();
        if (n) bound.add(n);
      });
    }
    for (const m of body.matchAll(/(?:const|let|var)\s*\[([^\]]+)\]\s*=/g)) {
      m[1].split(',').forEach(p => { const n = p.trim(); if (n) bound.add(n); });
    }
    for (const m of body.matchAll(/(?:function\s*)?\(([^)]*)\)\s*=>/g)) {
      m[1].split(',').forEach(p => {
        const n = p.trim().split('=')[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(n)) bound.add(n);
      });
    }
    for (const m of body.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);

    /* Only object-literal SHORTHAND is examined — `{ deviationTracked }` — not
     * every identifier in the file. Shorthand is where this bug lives, it is
     * unambiguous to find, and widening the net would drown the real finding in
     * false positives from property names and string contents. */
    for (const m of body.matchAll(/res\.json\(\s*\{([\s\S]{0,600}?)\}\s*\)/g)) {
      for (const part of m[1].split(',')) {
        const t = part.trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(t)) continue;   // key: value pairs, spreads, calls
        shorthandsChecked++;
        if (!bound.has(t)) offenders.push({ handler: h.name, name: t });
      }
    }
  }

  check(`every name res.json hands back is bound where it is used`,
    offenders.length === 0, offenders);
  check('and the check actually examined something',
    shorthandsChecked > 0, { shorthandsChecked });

  // The specific regression, named, so it cannot come back quietly.
  const early = handlers.find(h => h.name === '/attendance/early-late');
  check('the early/late report exists', !!early, handlers.map(h => h.name).slice(0, 5));
  if (early) {
    const body = lines.slice(early.from - 1, early.to).join('\n');
    check('and it declares deviationTracked itself, rather than borrowing it',
      /const deviationTracked\s*=/.test(body));
    check('and its catch says what went wrong instead of swallowing it',
      /catch[\s\S]{0,200}logger\.error/.test(body));
  }

  // The logger it now uses has to actually be imported, or the catch throws a
  // second ReferenceError on top of the first — the same bug, one level down.
  check('logger is imported at module scope', modScope.has('logger'));
}

const failed = checks.filter(c => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
process.exit(failed ? 1 : 0);
