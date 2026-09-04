/* Does this address belong to that network?
 *
 * Written out rather than pulled from a package because it decides whether
 * somebody's day is recorded as office or not, and a dependency that silently
 * changes its parsing rules would change attendance records. It is sixty
 * lines and it is tested.
 *
 * THE SHAPES ACCEPTED
 *
 *   203.0.113.7          a single address
 *   203.0.113.0/24       an IPv4 network
 *   2401:4900::/32       an IPv6 network
 *   ::ffff:203.0.113.7   IPv4 wearing an IPv6 coat — normalised to the IPv4
 *
 * That last one is not a curiosity. Node hands out IPv4-mapped addresses on
 * a dual-stack socket, so a rule written as 203.0.113.7 has to match an
 * arriving ::ffff:203.0.113.7 or every office rule would quietly never fire.
 *
 * A prefix of /0 is refused everywhere. "0.0.0.0/0" is every address on the
 * internet, and an office whose network is the entire internet would mark the
 * whole company present from anywhere. It is far more likely to be a mistake
 * than an intention, so it is rejected at the point somebody types it.
 */

const V4 = 4, V6 = 6;

/* Strip the things that travel with an address but are not part of it: a
 * zone index, brackets, and the IPv4-mapped prefix. */
function normalize(ip) {
  if (typeof ip !== 'string') return null;
  let s = ip.trim();
  if (!s) return null;
  const pct = s.indexOf('%');
  if (pct !== -1) s = s.slice(0, pct);
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  return mapped ? mapped[1] : s;
}

function parseV4(s) {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function parseV6(s) {
  if (!/^[0-9a-f:.]+$/i.test(s)) return null;
  /* A trailing dotted quad is legal IPv6 — rewrite it as two hex groups so
     the rest of this only has to understand one notation. */
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const v4 = parseV4(tail[2]);
    if (v4 === null) return null;
    const hi = (v4 >> 16n).toString(16), lo = (v4 & 0xffffn).toString(16);
    s = `${tail[1]}${hi}:${lo}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part) => (part === '' ? [] : part.split(':'));
  const head = toGroups(halves[0]);
  const tailGroups = halves.length === 2 ? toGroups(halves[1]) : null;

  let groups;
  if (tailGroups === null) {
    groups = head;
    if (groups.length !== 8) return null;
  } else {
    const fill = 8 - head.length - tailGroups.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tailGroups];
  }

  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  return v;
}

/* An address as { version, value }, or null if it is not one. */
function parseIP(ip) {
  const s = normalize(ip);
  if (!s) return null;
  if (s.includes(':')) {
    const v = parseV6(s);
    return v === null ? null : { version: V6, value: v };
  }
  const v = parseV4(s);
  return v === null ? null : { version: V4, value: v };
}

/* A rule as { version, base, prefix, text }, or null. Throws nothing —
 * callers decide whether a bad rule is a validation error or a skipped row. */
function parseRule(rule) {
  if (typeof rule !== 'string') return null;
  const text = rule.trim();
  if (!text) return null;
  const [addrPart, prefixPart] = text.split('/');
  const addr = parseIP(addrPart);
  if (!addr) return null;

  const bits = addr.version === V4 ? 32 : 128;
  let prefix = bits;
  if (prefixPart !== undefined) {
    if (!/^\d{1,3}$/.test(prefixPart)) return null;
    prefix = Number(prefixPart);
    if (prefix < 1 || prefix > bits) return null;   // /0 refused, see the header
  }

  /* Mask the base down to the network. Somebody typing 203.0.113.7/24 means
     that /24, and quietly matching nothing because the host bits were set
     would be the least helpful possible response. */
  const hostBits = BigInt(bits - prefix);
  const base = (addr.value >> hostBits) << hostBits;
  return { version: addr.version, base, prefix, bits, text };
}

function matches(ip, rule) {
  const addr = parseIP(ip);
  const net = typeof rule === 'string' ? parseRule(rule) : rule;
  if (!addr || !net || addr.version !== net.version) return false;
  const hostBits = BigInt(net.bits - net.prefix);
  return ((addr.value >> hostBits) << hostBits) === net.base;
}

/* The first rule that matches, or null. Returns the rule so the caller can
   say WHICH network placed somebody — "matched 10.0.0.0/8" is answerable,
   "matched an office network" is not. */
function firstMatch(ip, rules) {
  if (!Array.isArray(rules)) return null;
  for (const r of rules) {
    const net = parseRule(r);
    if (net && matches(ip, net)) return net.text;
  }
  return null;
}

/* Validation for the settings screen: returns the cleaned list or throws with
   a message naming the offending entry. */
function cleanRules(list, label = 'IP address') {
  if (list === null || list === undefined || list === '') return [];
  const arr = Array.isArray(list)
    ? list
    : String(list).split(/[\n,]/);
  const out = [];
  for (const raw of arr) {
    const s = String(raw).trim();
    if (!s) continue;
    const net = parseRule(s);
    if (!net) {
      throw new Error(
        `"${s}" is not a valid ${label} or range. Use 203.0.113.7 for one address `
        + `or 203.0.113.0/24 for a network.`);
    }
    if (!out.includes(net.text)) out.push(net.text);
  }
  return out;
}

module.exports = { parseIP, parseRule, matches, firstMatch, cleanRules, normalize };
