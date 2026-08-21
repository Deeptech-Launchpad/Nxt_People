/**
 * Fetch the photographic cover banners into public/covers.
 *
 * Six SVGs ship with the app and always work. Photographs are better as a
 * banner, but they cannot be committed from every machine — a laptop behind a
 * corporate network may not reach the image host at all, and a deploy server
 * that can reach it usually has no push access to the repository.
 *
 * So the recipe lives here instead of the binaries. Run it wherever the images
 * are wanted; after a rebuild, or on a second deployment, it is one command
 * rather than six.
 *
 *   node fetch_cover_banners.cjs
 *   node fetch_cover_banners.cjs --force     re-download files already present
 *
 * Nothing is written unless the download actually looks like an image. A
 * captive portal or an error page saved as .jpg is a broken tile that only
 * surfaces when somebody picks it, which is worse than no file at all.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = path.join(__dirname, 'public', 'covers');
const FORCE = process.argv.includes('--force');

// Picsum serves Unsplash photographs, which are free for commercial use with
// no attribution required. Fixed ids rather than /random, so every deployment
// gets the same set and somebody's chosen banner does not change under them.
const BANNERS = [
  { name: 'space.jpg',     id: 903 },
  { name: 'leaves.jpg',    id: 1043 },
  { name: 'forest.jpg',    id: 1018 },
  { name: 'road.jpg',      id: 1015 },
  { name: 'mountains.jpg', id: 1036 },
  { name: 'coast.jpg',     id: 1016 },
];

const URL_FOR = id => `https://picsum.photos/id/${id}/1600/400`;

// Anything smaller than this is not a photograph — it is an error page, a
// redirect body, or nothing at all.
const MIN_BYTES = 8 * 1024;

const get = (url, depth = 0) => new Promise((resolve, reject) => {
  if (depth > 5) return reject(new Error('too many redirects'));
  https.get(url, { timeout: 20000 }, res => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      return resolve(get(new URL(res.headers.location, url).toString(), depth + 1));
    }
    if (res.statusCode !== 200) {
      res.resume();
      return reject(new Error(`HTTP ${res.statusCode}`));
    }
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
  }).on('error', reject).on('timeout', function () {
    this.destroy(new Error('timed out'));
  });
});

(async () => {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  console.log(`\n  Cover banners into ${path.relative(process.cwd(), DIR)}\n`);

  let written = 0, skipped = 0, failed = 0;

  for (const b of BANNERS) {
    const dest = path.join(DIR, b.name);
    if (fs.existsSync(dest) && !FORCE) {
      console.log(`  skip   ${b.name.padEnd(16)} already here`);
      skipped++;
      continue;
    }
    try {
      const buf = await get(URL_FOR(b.id));
      if (buf.length < MIN_BYTES) throw new Error(`only ${buf.length} bytes — not an image`);
      fs.writeFileSync(dest, buf);
      console.log(`  ok     ${b.name.padEnd(16)} ${(buf.length / 1024).toFixed(0)} kB`);
      written++;
    } catch (err) {
      console.log(`  FAILED ${b.name.padEnd(16)} ${err.message}`);
      failed++;
    }
  }

  console.log(`\n  ${written} written, ${skipped} already present, ${failed} failed.`);
  if (failed) {
    console.log('  A failure here usually means this machine cannot reach the image host.');
    console.log('  The app still works — the banners that ship with it are unaffected.');
  }
  console.log('  Run `npm run build` to pick them up.\n');

  // A partial set is not a failure worth stopping a deploy over: the SVGs are
  // still there and the picker still works.
  process.exit(0);
})();
