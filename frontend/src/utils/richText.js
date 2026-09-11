/**
 * A deliberately small markup language for announcement bodies.
 *
 * The obvious way to give HR a formatting toolbar is a contenteditable that
 * emits HTML, but an announcement is written by one person and rendered into
 * every employee's browser — that is the one shape of content where storing
 * raw HTML means shipping a sanitizer, and a hand-written sanitizer is a bad
 * thing to own. So the stored value stays plain text, every character is
 * escaped before anything else happens, and the only tags that can appear in
 * the output are the ones introduced below.
 *
 * Supported, matching the buttons the toolbar shows:
 *   **bold**  *italic*  __underline__  ~~strike~~
 *   [label](https://…)          links, http/https/mailto only
 *   - item / 1. item            lists
 *   blank line                  paragraph break
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Anything that is not plainly a web or mail address is rendered as text. A
// bare `javascript:` is the reason this is an allowlist and not a blocklist.
const safeHref = (raw) => {
  const url = String(raw || '').trim();
  return /^(https?:\/\/|mailto:)[^\s"']+$/i.test(url) ? url : null;
};

const inline = (escaped) =>
  escaped
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
      // href arrives already escaped, so &amp; has to come back before the
      // protocol test and the attribute is re-escaped on the way out.
      const decoded = href.replace(/&amp;/g, '&');
      const safe = safeHref(decoded);
      return safe
        ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" class="underline">${label}</a>`
        : whole;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

/** @returns {string} HTML safe to hand to dangerouslySetInnerHTML. */
export function renderRichText(src) {
  const lines = escapeHtml(src).split(/\r?\n/);
  const out = [];
  let list = null; // 'ul' | 'ol'

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || number) {
      const want = bullet ? 'ul' : 'ol';
      if (list !== want) { closeList(); list = want; out.push(`<${want} class="list-${want === 'ul' ? 'disc' : 'decimal'} pl-5 space-y-0.5">`); }
      out.push(`<li>${inline((bullet || number)[1])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) { out.push('<p class="h-2"></p>'); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}

/** Markers stripped, for one-line previews and notification text. */
export function richTextToPlain(src) {
  return String(src ?? '')
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/gm, '')
    .trim();
}
