import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Satellite, Map as MapIcon } from 'lucide-react';

/* Pick the office on a map, and see the fence you are drawing.
 *
 * The office pin was typed as two numbers and landed 564 m from the building.
 * Nothing on screen could have shown that: 11.0308 and 11.0257 look equally
 * plausible in a text box, and the error only surfaced when everybody at the
 * office was recorded as working from home. A map makes that class of mistake
 * impossible to miss — the marker is either on the building or it is not.
 *
 * The circle matters as much as the marker. A radius is an abstract number
 * until it is drawn, and then it obviously does or does not reach the main
 * road, the car park, the building next door.
 *
 * Leaflet with OpenStreetMap and Esri imagery rather than the Google Maps API:
 * no key to manage, no billing to enable, and no per-load charge. Satellite is
 * the default view because you are looking for YOUR building, and a line map
 * of an industrial estate all looks the same.
 */

/* Leaflet's default marker icon is loaded by a relative URL that assumes the
 * library sits at the site root. Under a bundler it does not, so the pin is
 * invisible — the single most common Leaflet mistake. Drawn as an SVG instead,
 * which also lets it match the rest of the product. */
const PIN = L.divIcon({
  className: '',
  iconSize: [26, 36],
  iconAnchor: [13, 34],
  html: `<svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 23 13 23s13-13.8 13-23c0-7.2-5.8-13-13-13z" fill="#2563eb"/>
    <circle cx="13" cy="13" r="5" fill="#fff"/>
  </svg>`,
});

const LAYERS = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri',
    maxZoom: 19,
  },
  street: {
    label: 'Map',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
};

const COIMBATORE = [11.0168, 76.9558];

export default function LocationMapPicker({ latitude, longitude, radiusMeters, onPick }) {
  const holder = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const circle = useRef(null);
  const tiles = useRef(null);
  const [layer, setLayer] = useState('satellite');

  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  const radius = Number(radiusMeters) || 300;

  // ── build once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (map.current || !holder.current) return;
    const start = hasPoint ? [lat, lng] : COIMBATORE;
    map.current = L.map(holder.current, { attributionControl: true })
      .setView(start, hasPoint ? 17 : 13);

    tiles.current = L.tileLayer(LAYERS[layer].url, {
      attribution: LAYERS[layer].attribution, maxZoom: LAYERS[layer].maxZoom,
    }).addTo(map.current);

    circle.current = L.circle(start, {
      radius, color: '#2563eb', weight: 2, fillColor: '#2563eb', fillOpacity: 0.12,
    }).addTo(map.current);

    marker.current = L.marker(start, { icon: PIN, draggable: true }).addTo(map.current);

    /* Dragging the pin and clicking the map are the same action, so both go
     * through one handler. The parent owns the coordinates; this only ever
     * reports them upward, which keeps the text fields and the map from
     * fighting over which is the truth. */
    const place = (ll) => {
      marker.current.setLatLng(ll);
      circle.current.setLatLng(ll);
      onPick(ll.lat.toFixed(7), ll.lng.toFixed(7));
    };
    marker.current.on('dragend', e => place(e.target.getLatLng()));
    map.current.on('click', e => place(e.latlng));

    /* Leaflet measures the container when it starts. Inside a form that was
     * still laying out, that measurement is zero and the map renders as a
     * grey box until something forces a resize. */
    setTimeout(() => map.current && map.current.invalidateSize(), 60);

    return () => { if (map.current) { map.current.remove(); map.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── follow the fields, so typing a coordinate moves the pin ─────────────
  useEffect(() => {
    if (!map.current || !hasPoint) return;
    const ll = [lat, lng];
    marker.current.setLatLng(ll);
    circle.current.setLatLng(ll);
    map.current.setView(ll, Math.max(map.current.getZoom(), 16));
  }, [lat, lng, hasPoint]);

  useEffect(() => {
    if (circle.current) circle.current.setRadius(radius);
  }, [radius]);

  useEffect(() => {
    if (!map.current || !tiles.current) return;
    tiles.current.setUrl(LAYERS[layer].url);
    tiles.current.options.attribution = LAYERS[layer].attribution;
  }, [layer]);

  return (
    <div className="relative rounded-lg overflow-hidden border border-slate-200">
      <div ref={holder} style={{ height: 320 }} className="w-full bg-slate-100" />

      <div className="absolute top-2 right-2 z-[400] flex rounded-lg overflow-hidden shadow border border-white/60">
        {Object.entries(LAYERS).map(([key, l]) => (
          <button key={key} type="button" onClick={() => setLayer(key)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] font-medium ${
              layer === key ? 'bg-blue-600 text-white' : 'bg-white/95 text-slate-600 hover:bg-white'}`}>
            {key === 'satellite' ? <Satellite size={13} /> : <MapIcon size={13} />} {l.label}
          </button>
        ))}
      </div>

      {!hasPoint && (
        <div className="absolute inset-x-0 bottom-0 z-[400] bg-slate-900/75 text-white text-[12.5px] px-3 py-2">
          Click the map on your building, or press <strong>Use my current location</strong> while standing there.
        </div>
      )}
    </div>
  );
}
