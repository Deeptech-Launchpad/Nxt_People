/**
 * geoPermission.js — app-level location consent + capture for attendance.
 *
 * Behavior:
 * - 'Allow Always' → stored in localStorage, GPS captured silently every check-in/out
 * - 'Allow This Time' → GPS captured once, modal shows again next time
 * - 'Deny' → GPS skipped this time, modal shows again next time (never stored permanently)
 */

const PREF_KEY = 'nxt_geo_pref';   // 'always' | (absent = ask)

export const getGeoPref = () => {
  try { return localStorage.getItem(PREF_KEY); } catch { return null; }
};
export const setGeoPref = (v) => {
  try { v ? localStorage.setItem(PREF_KEY, v) : localStorage.removeItem(PREF_KEY); } catch { /* ignore */ }
};
/** Clear the remembered choice so the prompt appears again next time. */
export const resetGeoPref = () => setGeoPref(null);

// The modal registers its "ask the user" function here.
let askHandler = null;
export const _registerGeoHandler = (fn) => { askHandler = fn; };

// How long to wait on the consent modal before giving up on location.
const CONSENT_TIMEOUT_MS = 120000;

/** Resolve with `fallback` if `p` hasn't settled within `ms`. Never rejects. */
function withTimeout(p, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const t = setTimeout(() => finish(fallback), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); finish(v); },
      () => { clearTimeout(t); finish(fallback); }
    );
  });
}

/**
 * Handle consent only — start GPS capture immediately after, return the
 * running promise without awaiting it. Lets callers fire the API call in
 * parallel with GPS acquisition instead of waiting for GPS first.
 * Returns { gpsPromise, permissionStatus }.
 */
export async function startLocationCapture() {
  if (navigator.permissions) {
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'denied') {
        return { gpsPromise: Promise.resolve(null), permissionStatus: 'browser_denied' };
      }
    } catch (_) {}
  }

  const pref = getGeoPref();

  if (pref === 'always') {
    return { gpsPromise: capturePosition(), permissionStatus: 'always' };
  }

  // The consent modal is a prompt the user may simply never answer. Cap the
  // wait so an ignored prompt can't leave a caller pending for the life of
  // the page — treat silence as "no location this time", never as consent.
  const choice = askHandler ? await withTimeout(askHandler(), CONSENT_TIMEOUT_MS, 'deny') : 'once';

  if (choice === 'deny') {
    return { gpsPromise: Promise.resolve(null), permissionStatus: 'denied' };
  }

  if (choice === 'always') setGeoPref('always');

  return {
    gpsPromise: capturePosition(),
    permissionStatus: choice === 'always' ? 'always' : 'once',
  };
}

/** Capture one GPS fix. Resolves to coords or null (never rejects). */
export function capturePosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  });
}

/**
 * Ensure consent, then capture. Returns coords (or null) + the permission status.
 */
export async function requestLocation() {
  // Detect browser-level denial before showing our modal or waiting for GPS
  if (navigator.permissions) {
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'denied') {
        return { coords: null, permissionStatus: 'browser_denied' };
      }
    } catch (_) {}
  }

  const pref = getGeoPref();

  // Already said Allow Always — capture silently, no modal
  if (pref === 'always') {
    const coords = await capturePosition();
    return { coords, permissionStatus: coords ? 'always' : 'unavailable' };
  }

  // No stored preference — show the modal to ask. Same timeout guard as
  // startLocationCapture(): silence must never hang the caller.
  const choice = askHandler ? await withTimeout(askHandler(), CONSENT_TIMEOUT_MS, 'deny') : 'once';

  if (choice === 'deny') {
    // Do NOT store 'denied' — next check-in will ask again
    return { coords: null, permissionStatus: 'denied' };
  }

  if (choice === 'always') setGeoPref('always');
  // 'once' → don't store, will ask next time

  const coords = await capturePosition();
  const permissionStatus = !coords ? 'unavailable' : (choice === 'always' ? 'always' : 'once');
  return { coords, permissionStatus };
}
