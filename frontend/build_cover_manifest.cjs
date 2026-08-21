/**
 * The list of banners the app offers, built from whatever is in the folder.
 *
 * Six SVGs ship with the app. Anybody wanting photographs instead — from
 * Unsplash, Pexels, or their own camera — drops the files into
 * public/covers/ and rebuilds. No code changes, nothing to register, and no
 * upload screen to keep in step with the folder.
 *
 * The manifest is written into public/ so it is served as a plain static file
 * beside the images themselves. The frontend reads it; the backend validates
 * only the SHAPE of a cover name, because it lives in a different container
 * and cannot see this folder.
 *
 *   node build_cover_manifest.cjs
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'public', 'covers');
const OUT = path.join(dir, 'manifest.json');
const ALLOWED = new Set(['.svg', '.jpg', '.jpeg', '.png', '.webp']);

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// "dusk-ridge.svg" reads as "Dusk ridge" on the tile. Deriving it means a file
// dropped in needs no accompanying edit anywhere.
const labelOf = (base) =>
  base.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase());

const covers = fs.readdirSync(dir)
  .filter(f => ALLOWED.has(path.extname(f).toLowerCase()))
  // The key is the filename without its extension, so swapping a .svg for a
  // .jpg of the same name keeps everybody's existing choice working.
  .map(f => ({
    key: path.basename(f, path.extname(f)),
    url: `/covers/${f}`,
    label: labelOf(path.basename(f, path.extname(f))),
    bytes: fs.statSync(path.join(dir, f)).size,
  }))
  .sort((a, b) => a.key.localeCompare(b.key));

fs.writeFileSync(OUT, JSON.stringify(covers, null, 2) + '\n');

const kb = covers.reduce((s, c) => s + c.bytes, 0) / 1024;
console.log(`cover manifest: ${covers.length} banner(s), ${kb.toFixed(1)} kB total`);
for (const c of covers) console.log(`  ${c.key.padEnd(16)} ${c.url}`);
if (!covers.length) {
  console.log('  No images in public/covers — the picker will offer nothing.');
}
