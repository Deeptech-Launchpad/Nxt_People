import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/* After a deploy, a tab still running the old build asks for page chunks that
 * no longer exist, and the page fails to load until a hard refresh. Two
 * guards: reload once when a chunk fails to load, and notice a new build when
 * the tab regains focus so the next page change loads it. */

const RELOAD_KEY = 'app-update:reloaded-at';
const CHECK_GAP_MS = 60_000;

const entryOf = (html) => (html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/) || [])[1] || null;

const currentEntry = () =>
  document.querySelector('script[type="module"][src^="/assets/"]')?.getAttribute('src') || null;

let updateReady = false;
let reloading = false;

function reloadOnce() {
  if (reloading) return true;
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* storage blocked */ }
  if (Date.now() - last < 30_000) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
  reloading = true;
  window.location.reload();
  return true;
}

let lastCheck = 0;
async function checkForUpdate() {
  if (updateReady || Date.now() - lastCheck < CHECK_GAP_MS) return;
  lastCheck = Date.now();
  const mine = currentEntry();
  if (!mine) return;
  try {
    const res = await fetch('/index.html', { cache: 'no-store' });
    if (!res.ok) return;
    const live = entryOf(await res.text());
    if (live && live !== mine) updateReady = true;
  } catch { /* offline */ }
}

export function installAppUpdate() {
  if (import.meta.env.DEV) return;
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadOnce()) e.preventDefault();
  });
  const onVisible = () => { if (document.visibilityState === 'visible') checkForUpdate(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
}

export function AppUpdateWatcher() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (updateReady) reloadOnce();
  }, [pathname]);
  return null;
}
