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
    return { gpsPromise: capturePositionCached(), permissionStatus: 'always' };
  }

  // The consent modal is a prompt the user may simply never answer. Cap the
  // wait so an ignored prompt can't leave a caller pending for the life of
  // the page — treat silence as "no location this time", never as consent.
  // Silence gets its OWN outcome ('timeout'), distinct from an actual click
  // on Deny: a caller that blocks on an explicit refusal must not also block
  // on someone who simply never saw the popup.
  const choice = askHandler ? await withTimeout(askHandler(), CONSENT_TIMEOUT_MS, 'timeout') : 'once';

  if (choice === 'deny' || choice === 'timeout') {
    return { gpsPromise: Promise.resolve(null), permissionStatus: choice === 'deny' ? 'denied' : 'timeout' };
  }

  if (choice === 'always') setGeoPref('always');

  return {
    gpsPromise: capturePositionCached(),
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
// The browser's own reason a fix failed, kept around for whoever logs the
// miss afterward. GPS_ERROR_NAME turns the numeric code the spec defines
// (1/2/3) into something a report can actually say instead of "unknown" —
// PERMISSION_DENIED shouldn't reach here (consent already gates the call),
// so seeing it anyway is itself informative.
const GPS_ERROR_NAME = { 1: 'permission_denied', 2: 'no_signal', 3: 'gps_timeout' };
let lastCaptureError = null;
export const getLastCaptureError = () => lastCaptureError;

function oneFix(enableHighAccuracy, timeout, maximumAge) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { lastCaptureError = 'unsupported'; return resolve(null); }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lastCaptureError = null;
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => { lastCaptureError = GPS_ERROR_NAME[err.code] || 'unknown'; resolve(null); },
      { enableHighAccuracy, timeout, maximumAge }
    );
  });
}

// The most recent successful fix, reused for a short window so a check-out
// moments after a check-in (or a re-check-in) does not pay the full GPS
// negotiation twice. Kept short on purpose — see capturePositionCached().
const FIX_CACHE_MS = 120000;
let cachedFix = null; // { latitude, longitude, accuracy, at }

function rememberFix(fix) {
  if (fix) cachedFix = { ...fix, at: Date.now() };
  return fix;
}

/* Only one live GPS request is ever allowed in flight at a time. The
 * background "keep a fix warm" refresh and an actual check-in/out click can
 * land in the same instant, and firing two concurrent getCurrentPosition()
 * calls turned out not to be safe here — both attempts came back with
 * nothing on a normal, well-connected desktop the moment this shipped,
 * immediately after check-in/out itself was made to wait on the earlier of
 * the two. Whatever call is already running is handed to every other caller
 * instead of starting a second one on top of it. */
let inFlight = null;

export async function capturePosition() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    // The primary attempt no longer refuses a fix the device already had
    // sitting from the last 45 seconds; the fallback still asks for a
    // lower-accuracy, network-based answer if that one comes back empty.
    const precise = await oneFix(true, 12000, 45000);
    return rememberFix(precise || await oneFix(false, 8000, 300000));
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/* A fix from the last two minutes is close enough for attendance purposes —
 * see the freshness analysis this was built from: 2 minutes is roughly where
 * a fix stops safely representing "where they still are" for someone who may
 * now be walking to their car. Anything reusing this cache is choosing speed
 * over asking the device again, which is the right trade for the common case
 * (check-out moments after being seen active on the page) and a no-op for the
 * rare one (cache empty or stale — falls straight through to a fresh ask). */
export async function capturePositionCached() {
  if (cachedFix && Date.now() - cachedFix.at <= FIX_CACHE_MS) {
    return cachedFix;
  }
  return capturePosition();
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
