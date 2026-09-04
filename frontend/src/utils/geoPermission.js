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

/** Capture one GPS fix. Resolves to coords or null (never rejects).
 *
 * enableHighAccuracy was FALSE here, which tells the browser not to bother
 * with GPS and to answer from wifi or the network instead. That was the right
 * trade when the fix was only being logged: cheaper, faster, and nothing
 * depended on it.
 *
 * It is the wrong trade now. The fix decides whether a check-in is recorded as
 * office or working from home, and a network fix routinely lands hundreds of
 * metres out — wider than the fence it is being measured against, so the
 * classification refuses to guess and the day comes back unplaced. The admin
 * screen's capture button was already asking for high accuracy, which is why
 * it read 93 m where a check-in from the same desk could not be placed at all.
 *
 * The longer timeout is the cost: a GPS lock takes seconds where a network fix
 * is instant. That is affordable precisely because this runs AFTER the punch is
 * recorded — nobody is waiting on it, and a fix that arrives five seconds late
 * still corrects the day.
 *
 * enableHighAccuracy also has a failure mode of its own: on 04/09/2026, 11
 * check-ins got no fix at all — not vague, NOTHING — while 33 people in the
 * same building granted permission the same day. A desktop with no GPS chip
 * asked to try harder for one has nowhere to try harder TO, and rather than
 * falling back the browser can time out or report POSITION_UNAVAILABLE. The
 * accurate fix a phone can give is still asked for first, but a failure now
 * gets one retry at low accuracy — the network/wifi fix that was always good
 * enough to log, and which office-network IP detection can now place exactly
 * without needing accuracy at all. Something logged and possibly unplaced
 * beats nothing logged and definitely unplaced. */
function oneFix(enableHighAccuracy, timeout, maximumAge) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      () => resolve(null),
      { enableHighAccuracy, timeout, maximumAge }
    );
  });
}

export async function capturePosition() {
  const precise = await oneFix(true, 12000, 0);
  if (precise) return precise;
  return oneFix(false, 8000, 300000);
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
