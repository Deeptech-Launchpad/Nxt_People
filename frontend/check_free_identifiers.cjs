/**
 * Identifiers used in a component that nothing in scope declares.
 *
 * A blank page on live came from exactly this: a patch meant for Dashboard
 * landed in RequestMenu, because both open with `const navigate =
 * useNavigate();` and the replacement took the first match. `cover` and
 * `loadCover` were then read in Dashboard's JSX with nothing declaring them —
 * a ReferenceError on render, and every screen went white.
 *
 * `npm run build` passed. esbuild bundles free identifiers happily and leaves
 * them to fail at runtime, so a green build says nothing about this.
 *
 * Deliberately crude. It parses nothing; it collects every name a file
 * declares, imports or takes as a parameter, then looks for JSX expressions
 * reading a name that appears nowhere in that list. That misses plenty, but it
 * catches the whole class of "this variable does not exist here" without
 * pulling in a parser, and it has no false-positive tolerance for the case
 * that actually broke: a bare local-looking identifier inside {...}.
 *
 *   node check_free_identifiers.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');

// Anything global, React-provided, or a browser API is not a free identifier.
const GLOBALS = new Set([
  'window', 'document', 'console', 'Math', 'JSON', 'Date', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Promise', 'Set', 'Map', 'RegExp', 'Error',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'fetch', 'FormData', 'Intl', 'React', 'undefined', 'null', 'true', 'false',
  'this', 'new', 'typeof', 'void', 'await', 'async', 'return', 'if', 'else',
  'URL', 'URLSearchParams', 'Blob', 'File', 'AbortController', 'Symbol',
  'BigInt', 'structuredClone', 'queueMicrotask', 'requestAnimationFrame',
]);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
};

// Every name this file could legitimately be referring to.
function declaredNames(src) {
  const names = new Set();
  const add = s => { if (s) String(s).split(/[\s,{}[\]:]+/).filter(Boolean).forEach(n => names.add(n)); };

  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*([{[][^=]*?[}\]])\s*=/g)) add(m[1]);
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // One statement can declare several: `const a = 1, b = 2;`. Taking only the
  // first name reported three real bindings as missing.
  for (const m of src.matchAll(/(?:const|let|var)\s+([^;\r\n]+)/g)) {
    for (const d of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*=/g)) names.add(d[1]);
  }
  for (const m of src.matchAll(/import\s+([^;]+?)\s+from/g)) add(m[1].replace(/\bas\b/g, ' '));
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g)) add(m[1]);
  // A single parameter needs no brackets: `e => …`, `async v => …`. Missing
  // these made the first run report eighty-two false positives, which is a
  // checker nobody would ever look at twice.
  for (const m of src.matchAll(/(?:^|[\s(,{[=;])(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) add(m[1]);
  for (const m of src.matchAll(/\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return names;
}

// Bare identifiers read inside a JSX expression: {foo}, {foo.bar}, {foo?.bar},
// {foo && …}, {foo ? … : …}. Attribute values like prop={foo} count too.
function jsxReads(src) {
  const found = new Map();
  // A `{` that is not part of a `${…}` template interpolation and not part of
  // a longer word. `prop={foo}` matches on its own brace, so no separate rule
  // is needed for attributes. Allowing a bare `=` matched `background=e0e7ff`
  // inside a URL and reported a hex colour as a missing variable.
  const re = /(?<![$\w])\{\s*([a-z_$][\w$]*)\s*(?=[?.&|)}\s])/g;
  const lines = src.split('\n');
  lines.forEach((rawLine, i) => {
    let line = rawLine;
    // Only look at lines that are plausibly JSX or a prop, not plain logic.
    if (!/[<>{]/.test(line)) return;
    // Comments describe shapes — `useState(null); // { record }` documents what
    // the state holds; it is not a read. Everything from // onwards goes.
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    line = line.split('//')[0];
    for (const m of line.matchAll(re)) {
      const name = m[1];
      if (!found.has(name)) found.set(name, i + 1);
    }
  });
  return found;
}

let problems = 0;
let scanned = 0;

for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  if (!/<[A-Za-z]/.test(src)) continue;   // no JSX, nothing to check
  scanned++;

  const declared = declaredNames(src);
  for (const [name, line] of jsxReads(src)) {
    if (GLOBALS.has(name) || declared.has(name)) continue;
    // A name that appears nowhere else in the file at all is the strong signal.
    const uses = (src.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
    if (uses > 3) continue;   // widely used — almost certainly a real binding this crude scan missed
    console.log(`  ${path.relative(SRC, file)}:${line}  reads "${name}", which nothing here declares`);
    problems++;
  }
}

console.log(`\n${scanned} file(s) with JSX scanned.`);
if (problems) {
  console.log(`${problems} identifier(s) look undeclared. Each one is a blank page if that branch renders.\n`);
  process.exit(1);
}
console.log('No undeclared identifiers found in JSX.\n');
