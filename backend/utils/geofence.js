/* Where a punch happened, and what that makes the day.
 *
 * One place, because the answer has to be identical wherever it is asked:
 * the check-in handler that records it, the admin screen that tests a pin
 * before it goes live, and any report that explains a day afterwards. Three
 * implementations of a distance would eventually be three answers.
 *
 * THE RULE
 *
 *   a punch is Office when it falls inside the radius of ANY active,
 *   geofenced location that has coordinates — nearest one wins, and the row
 *   records which. Visiting another company site is being at work, not
 *   working from home.
 *
 *   a punch outside every fence is WFH.
 *
 *   a punch we cannot place is UNKNOWN, and unknown is never quietly turned
 *   into WFH. No fix, a refused permission, or a fix too vague to sit on one
 *   side of the fence are all cases where the honest answer is "we do not
 *   know". Guessing puts a number into somebody's record that nobody can
 *   defend, and WFH may carry different pay or allowance.
 *
 * THE NETWORK IS THE SECOND SIGNAL. A desk machine has no GPS chip, so it
 * answers from whatever the network databases know about the office Wi-Fi —
 * which on 04/09/2026 was a point 995 m from the building, stated to ±1021 m,
 * identical to the metre for all sixteen people who got it. That is one
 * answer handed to sixteen machines, and it cannot say which side of a 400 m
 * wall anybody is on. But the packet those machines sent arrived FROM the
 * office network, and that carries no uncertainty at all. So a location may
 * also be described by the addresses it owns.
 *
 * PRECEDENCE: a conclusive GPS fix beats the network, always. GPS is evidence
 * about where the person is; an address is evidence about where their traffic
 * left from, and the two part company over a VPN. Anyone whose device can
 * actually answer the question gets answered by their device. The network is
 * what we fall back to when the device cannot — which is precisely the
 * desktop case it exists for.
 *
 * The residual hole is a desktop with no GPS connected to the office network
 * from home over a VPN: it will read as office. That is the same hole Zoho's
 * allowed-IP feature has, it requires deliberate effort to walk into, and the
 * alternative is 27 people a day going unplaced.
 *
 * ACCURACY IS THE TRAP. A phone indoors routinely reports a fix good to
 * ±300 m. Asked whether that punch is inside a 300 m fence, the honest answer
 * is that the question does not have one — the uncertainty is as large as the
 * thing being measured. So a fix whose accuracy is worse than the radius
 * resolves to unknown rather than to whichever side it happens to land on.
 */

const pool = require('../db');
const { firstMatch } = require('./ipMatch');

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

/* Great-circle distance in metres. Haversine rather than the flat
 * approximation: at these distances either would do, but a formula that is
 * only right near the equator is a bug waiting for a second office. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const DEFAULTS = {
  classifyEnabled: false,
  defaultRadiusMeters: 300,
  unknownCountsAs: 'unknown',
  requireAccuracy: true,
  blockOutsideFence: false,
};

async function config() {
  try {
    const r = await pool.query(`SELECT geofence_config AS c FROM settings LIMIT 1`);
    return { ...DEFAULTS, ...(r.rows[0]?.c || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function activeFences() {
  const r = await pool.query(
    `SELECT id, name, latitude::float8 AS lat, longitude::float8 AS lng, radius_meters AS radius
       FROM work_locations
      WHERE is_active AND geofence_enabled
        AND latitude IS NOT NULL AND longitude IS NOT NULL`);
  return r.rows;
}

/* Locations described by the addresses they own. Deliberately NOT joined to
 * the coordinate query: an office may be identified by its network without
 * anybody ever having pinned it on a map, and requiring both would make the
 * cheaper, more reliable signal depend on the harder one. */
async function ipLocations() {
  const r = await pool.query(
    `SELECT id, name, ip_ranges AS ips
       FROM work_locations
      WHERE is_active AND geofence_enabled
        AND ip_ranges IS NOT NULL AND array_length(ip_ranges, 1) > 0`);
  return r.rows;
}

/* Every location ranked by distance from a point. The admin screen's "test
 * from where I am" reads this, which is the whole reason a wrong pin gets
 * caught before it is switched on rather than after a week of bad days. */
async function rankLocations({ latitude, longitude }) {
  const cfg = await config();
  const fences = await activeFences();
  return fences
    .map(f => {
      const radius = f.radius || cfg.defaultRadiusMeters;
      const distance = distanceMeters(latitude, longitude, f.lat, f.lng);
      return { id: f.id, name: f.name, radius, distance, inside: distance <= radius };
    })
    .sort((a, b) => a.distance - b.distance);
}

/* THE decision. Returns a shape the caller stores verbatim:
 *
 *   { mode, locationId, locationName, distance, accuracy, reason }
 *
 * mode is 'office' | 'wfh' | 'unknown' | null. Null means classification is
 * switched off entirely, and the caller must not write a mode at all — an
 * off switch that still stamped every row would not be off. */
async function classifyPunch({ latitude, longitude, accuracy, ip, employee }) {
  const cfg = await config();
  if (!cfg.classifyEnabled) {
    return { mode: null, reason: 'classification is switched off' };
  }

  /* Somebody whose arrangement is to work from home is not measured against
   * an office. Checked before everything else, so a remote employee who
   * happens to be near the building — or on its Wi-Fi — is still remote:
   * their arrangement is not decided by where they stood this morning. */
  if (employee?.isRemote) {
    return { mode: 'wfh', reason: 'employee is marked remote', locationId: null, source: 'arrangement' };
  }

  const gps = await gpsVerdict({ latitude, longitude, accuracy, cfg });
  if (gps.mode) return gps;

  /* The device could not answer. Ask the network. */
  const net = await networkVerdict(ip);
  if (net) return { ...net, distance: gps.distance ?? null, accuracy: gps.accuracy ?? null };

  return {
    mode: cfg.unknownCountsAs, unknown: true, source: null,
    reason: gps.reason, distance: gps.distance ?? null, accuracy: gps.accuracy ?? null,
  };
}

/* What the coordinates say, or why they cannot say anything.
 *
 * Returns mode null when the answer is INCONCLUSIVE rather than negative —
 * the distinction the caller needs to know whether asking a second source is
 * reasonable or just shopping for a better answer. */
async function gpsVerdict({ latitude, longitude, accuracy, cfg }) {

  /* Number(null) is 0, and 0 is finite. Checking only isFinite let a punch
   * with NO fix through as the coordinates (0, 0) — a spot in the Gulf of
   * Guinea 8,584 km away — which then classified confidently as working from
   * home. Exactly the guess this function exists to refuse. Absence has to be
   * tested before conversion. */
  const present = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  if (!present(latitude) || !present(longitude)) {
    return { mode: null, reason: 'no location was captured' };
  }

  const fences = await activeFences();
  if (!fences.length) {
    return { mode: null, reason: 'no location has coordinates set' };
  }

  const ranked = await rankLocations({ latitude: Number(latitude), longitude: Number(longitude) });
  const nearest = ranked[0];
  const acc = Number.isFinite(Number(accuracy)) ? Math.round(Number(accuracy)) : null;

  /* The fix is too vague to answer the question it is being asked. */
  if (cfg.requireAccuracy && acc !== null && acc > nearest.radius) {
    return {
      mode: null,
      reason: `the fix is accurate to ${acc} m, which is wider than the ${nearest.radius} m fence`,
      distance: nearest.distance, accuracy: acc,
    };
  }

  const match = ranked.find(r => r.inside);
  if (match) {
    return {
      mode: 'office', locationId: match.id, locationName: match.name,
      distance: match.distance, accuracy: acc, source: 'gps',
      reason: `${match.distance} m from ${match.name}, inside its ${match.radius} m fence`,
    };
  }

  return {
    mode: 'wfh', locationId: null,
    distance: nearest.distance, accuracy: acc, source: 'gps',
    reason: `${nearest.distance} m from the nearest location (${nearest.name}), outside its ${nearest.radius} m fence`,
  };
}

/* What the address says, or null if it says nothing.
 *
 * Only ever returns 'office'. An address that matches no office is not
 * evidence of working from home — a mobile network, a co-working space and
 * a kitchen table are indistinguishable from here — so an unmatched address
 * leaves the day unplaced rather than asserting the opposite. */
async function networkVerdict(ip) {
  if (!ip) return null;
  let locations;
  try { locations = await ipLocations(); } catch { return null; }
  for (const loc of locations) {
    const matched = firstMatch(ip, loc.ips);
    if (matched) {
      return {
        mode: 'office', locationId: loc.id, locationName: loc.name, source: 'network',
        reason: `checked in from ${matched}, a network belonging to ${loc.name}`,
      };
    }
  }
  return null;
}

/* Many points, one pass. The location history table draws a verdict beside
 * every captured fix; calling classifyPunch per row would re-read the config
 * and the fences once per line. Same rule, one round trip. */
async function classifyMany(points) {
  const cfg = await config();
  if (!cfg.classifyEnabled) return points.map(() => ({ mode: null }));
  const fences = await activeFences();
  if (!fences.length) return points.map(() => ({ mode: cfg.unknownCountsAs, unknown: true }));

  const present = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  return points.map(p => {
    if (p?.isRemote) return { mode: 'wfh', reason: 'employee is marked remote' };
    if (!present(p?.latitude) || !present(p?.longitude)) {
      return { mode: cfg.unknownCountsAs, unknown: true, reason: 'no location was captured' };
    }
    const ranked = fences
      .map(f => {
        const radius = f.radius || cfg.defaultRadiusMeters;
        return { id: f.id, name: f.name, radius,
          distance: distanceMeters(Number(p.latitude), Number(p.longitude), f.lat, f.lng) };
      })
      .sort((a, b) => a.distance - b.distance);
    const nearest = ranked[0];
    const acc = present(p.accuracy) ? Math.round(Number(p.accuracy)) : null;
    if (cfg.requireAccuracy && acc !== null && acc > nearest.radius) {
      return { mode: cfg.unknownCountsAs, unknown: true, distance: nearest.distance,
        reason: `the fix is accurate to ${acc} m, wider than the ${nearest.radius} m fence` };
    }
    const inside = ranked.find(r => r.distance <= r.radius);
    return inside
      ? { mode: 'office', locationId: inside.id, locationName: inside.name, distance: inside.distance }
      : { mode: 'wfh', distance: nearest.distance, locationName: nearest.name };
  });
}

module.exports = { distanceMeters, classifyPunch, classifyMany, rankLocations, networkVerdict, config, DEFAULTS };
