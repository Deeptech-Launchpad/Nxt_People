/**
 * geoPermission.js — app-level location consent + capture for attendance.
 *
 * Browsers don't let us restyle the native geolocation popup, so we show our
 * own pre-prompt (Allow Always / Allow This Time / Deny) via <GeoPermissionModal>,
 * remember the durable choices, and only then capture coordinates.
 *
 *   requestLocation() →  { coords: {latitude,longitude,accuracy}|null, permissionStatus }
 *     permissionStatus ∈ 'always' | 'once' | 'denied' | 'unavailable'
 *
 * 'always'/'denied' are persisted in localStorage so we never re-ask; 'once'
 * captures a single time without persisting. The mounted modal registers a
 * handler here so requestLocation() can be called from anywhere (e.g. the
 * AttendanceContext check-in flow) without prop-drilling.
 */

const PREF_KEY = 'nxt_geo_pref';   // 'always' | 'denied' | (absent = ask)

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
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/**
 * Ensure consent, then capture. Returns coords (or null) + the permission
 * status to store alongside the attendance record.
 */
export async function requestLocation() {
  const pref = getGeoPref();

  if (pref === 'denied') {
    // User previously denied our custom modal, but their device GPS may still
    // be on. Try to capture anyway — if it works, unblock them and use it.
    const coords = await capturePosition();
    if (coords) {
      setGeoPref('always');
      return { coords, permissionStatus: 'always' };
    }
    return { coords: null, permissionStatus: 'denied' };
  }
  if (pref === 'always') {
    const coords = await capturePosition();
    return { coords, permissionStatus: coords ? 'always' : 'unavailable' };
  }

  // No durable choice yet — ask via the modal. Fallback to a one-time capture
  // if the modal isn't mounted for some reason.
  const choice = askHandler ? await askHandler() : 'once';   // 'always' | 'once' | 'deny'

  if (choice === 'deny') {
    setGeoPref('denied');
    return { coords: null, permissionStatus: 'denied' };
  }
  if (choice === 'always') setGeoPref('always');

  const coords = await capturePosition();
  const permissionStatus = !coords ? 'unavailable' : (choice === 'always' ? 'always' : 'once');
  return { coords, permissionStatus };
}
