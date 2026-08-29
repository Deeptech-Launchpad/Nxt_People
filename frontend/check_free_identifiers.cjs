/* ── Identifiers used but never declared ────────────────────────────────────
 *  `npm run build` cannot catch these. Bundlers treat an unknown name as a
 *  possible global and leave it to fail at runtime, so a green build says
 *  nothing about this class of bug at all.
 *
 *  It has broken production twice:
 *
 *    A patch meant for Dashboard landed in RequestMenu, because both open with
 *    `const navigate = useNavigate();` and the replacement took the first
 *    match. `cover` and `loadCover` were then read in Dashboard's JSX with
 *    nothing declaring them — ReferenceError on render, every screen white.
 *
 *    Removing a Backlog tab took two `const` lines with it, leaving the
 *    Approvals page reading `approved` and `rejected` in a plain object
 *    literal. The page loaded, the request succeeded, and the throw landed in
 *    a .catch() where `err.response` is undefined — so it reported "Failed to
 *    load approvals", which reads like the request failed.
 *
 *  The first version of this file parsed nothing and looked only inside JSX
 *  {...} expressions. It missed the second incident entirely, being a plain
 *  object literal — and, tested afterwards, missed a bare undefined identifier
 *  in JSX too. This one uses a real parser and resolves every identifier
 *  against its scope chain, so both cases are caught wherever they appear.
 *
 *  @babel/parser and @babel/traverse are already present via Vite, so there is
 *  no new dependency. .cjs because this package is an ES module.
 *
 *    node check_free_identifiers.cjs
 *
 *  Exits non-zero when anything is found; `npm run build` runs it first.
 * ───────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

/* Things that legitimately exist without being declared in the file. Kept
 * deliberately short: every name added here is a name this check can no longer
 * protect, so it is better to import something than to list it. */
const GLOBALS = new Set([
  // Browser
  'window', 'document', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'fetch', 'console', 'alert', 'confirm', 'prompt', 'Blob',
  'File', 'FileReader', 'FormData', 'URL', 'URLSearchParams', 'Image', 'Audio',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
  'WebSocket', 'EventSource', 'AbortController', 'Notification', 'crypto', 'performance',
  'CustomEvent', 'Event', 'DOMParser', 'getComputedStyle', 'matchMedia', 'scrollTo',
  'atob', 'btoa', 'structuredClone', 'queueMicrotask', 'HTMLElement', 'Node',
  // Deprecated but real, and still the usual way to base64-decode UTF-8.
  'escape', 'unescape',
  // Language
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math',
  'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'globalThis', 'undefined',
  'NaN', 'Infinity', 'Function', 'ArrayBuffer', 'Uint8Array', 'TextEncoder',
  'TextDecoder', 'Intl',
  // Build-time
  'process', 'import', 'require', 'module', 'exports', '__dirname', '__filename',
]);

const SRC = path.join(__dirname, 'src');
const findings = [];
let scanned = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(jsx?|mjs)$/.test(entry.name)) check(full);
  }
}

function check(file) {
  const code = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator',
                'objectRestSpread', 'dynamicImport', 'topLevelAwait'],
    });
  } catch (e) {
    findings.push({ file, line: e.loc?.line ?? 0, name: `could not be parsed — ${e.message}` });
    return;
  }
  scanned += 1;

  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (GLOBALS.has(name)) return;
      // A binding anywhere up the scope chain means it is declared.
      if (p.scope.hasBinding(name, true)) return;
      // JSX element names starting with a capital are components; a missing one
      // is still a real problem, so they are NOT skipped.
      findings.push({ file, line: p.node.loc?.start.line ?? 0, name });
    },
  });
}

walk(SRC);

const rel = f => path.relative(__dirname, f).replace(/\\/g, '/');
console.log(`\n  Checked ${scanned} file(s) under src/\n`);

if (!findings.length) {
  console.log('  No undefined names.\n');
  process.exit(0);
}

// Grouped by file, because one missing import usually explains several.
const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}
console.log(`  ${findings.length} undefined name(s) in ${byFile.size} file(s):\n`);
for (const [file, list] of byFile) {
  console.log(`    ${rel(file)}`);
  for (const f of list) console.log(`      line ${f.line}: ${f.name}`);
  console.log('');
}
process.exit(1);
