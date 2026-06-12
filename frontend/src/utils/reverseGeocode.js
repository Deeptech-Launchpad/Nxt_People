/**
 * reverseGeocode.js — turn captured GPS coordinates into a human place name.
 *
 * Display-only helper for the Location page. The browser geolocation API only
 * ever gives coordinates, so to show the *actual* location name we look it up
 * from the coordinates via OpenStreetMap Nominatim (free, no API key).
 *
 * Heavily cached (in-memory + localStorage, keyed by rounded coordinates) so we
 * don't re-request the same spot — Nominatim asks callers to keep volume light.
 */

const memCache = new Map();
const LS_KEY = 'nxt_geocode_cache_v1';

const loadLs = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } };
const saveLs = (o) => { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { /* ignore */ } };

// ~11 m precision — enough to dedupe repeated check-ins at the same place.
export const coordKey = (lat, lng) =>
  (lat === null || lat === undefined || lng === null || lng === undefined)
    ? null
    : `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;

// Build a short, readable name from Nominatim's structured address.
function shortName(data) {
  const a = data?.address || {};
  const parts = [
    a.road || a.pedestrian || a.neighbourhood || a.suburb || a.hamlet,
    a.suburb || a.village || a.town || a.city_district,
    a.city || a.town || a.village || a.county,
  ].filter(Boolean);
  const uniq = [...new Set(parts)];
  return uniq.slice(0, 3).join(', ') || data?.display_name || null;
}

/** Resolve a place name for the coordinates, or null if it can't be determined. */
export async function reverseGeocode(lat, lng) {
  const key = coordKey(lat, lng);
  if (!key) return null;
  if (memCache.has(key)) return memCache.get(key);

  const ls = loadLs();
  if (ls[key]) { memCache.set(key, ls[key]); return ls[key]; }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error('geocode failed');
    const data = await res.json();
    const name = shortName(data);
    if (name) {
      memCache.set(key, name);
      ls[key] = name;
      saveLs(ls);
    }
    return name;
  } catch {
    return null;
  }
}
