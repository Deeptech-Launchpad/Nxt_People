/**
 * GeoPermissionModal — our app-level location consent prompt.
 *
 * Mounted once (in Layout). It registers an async "ask" handler with
 * geoPermission.js; when the attendance flow calls requestLocation() and no
 * durable choice is stored, this modal opens and resolves with the user's
 * choice: 'always' | 'once' | 'deny'.
 */
import React, { useState, useEffect, useRef } from 'react';
import { MapPin, X } from 'lucide-react';
import { _registerGeoHandler } from '../utils/geoPermission';

export default function GeoPermissionModal() {
  const [open, setOpen] = useState(false);
  const [browserDenied, setBrowserDenied] = useState(false);
  const resolveRef = useRef(null);

  useEffect(() => {
    _registerGeoHandler(() => new Promise((resolve) => {
      resolveRef.current = resolve;
      setOpen(true);
    }));
    return () => _registerGeoHandler(null);
  }, []);

  // Check for a browser-level permanent denial whenever the modal opens, so
  // we can show recovery instructions instead of a consent choice that would
  // just fail silently anyway.
  useEffect(() => {
    if (!open) { setBrowserDenied(false); return; }
    let cancelled = false;
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' })
        .then((perm) => { if (!cancelled && perm.state === 'denied') setBrowserDenied(true); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [open]);

  const choose = (choice) => {
    setOpen(false);
    const r = resolveRef.current;
    resolveRef.current = null;
    r?.(choice);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <MapPin size={18} />
            </div>
            <h3 className="text-[17px] font-bold text-slate-800">Share your location?</h3>
          </div>
          <button onClick={() => choose('deny')} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {browserDenied ? (
          <>
            <div className="px-5 py-4">
              <p className="text-[15px] text-slate-600 leading-relaxed">
                Location is blocked for this site at the browser level. Click the lock icon in
                the address bar → Location → Allow, then try again.
              </p>
            </div>
            <div className="px-5 pb-5">
              <button
                onClick={() => choose('deny')}
                className="w-full border border-slate-200 text-slate-700 hover:bg-slate-50 py-2.5 rounded-lg text-[15px] font-semibold transition-colors"
              >
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-5 py-4">
              <p className="text-[15px] text-slate-600 leading-relaxed">
                NXT People would like to record where you check in and out for attendance.
                Your location is captured only at that moment and saved to your attendance
                location history.
              </p>
            </div>

            <div className="px-5 pb-5 space-y-2">
              <button
                onClick={() => choose('always')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-[15px] font-semibold transition-colors"
              >
                Allow Always
              </button>
              <button
                onClick={() => choose('once')}
                className="w-full border border-slate-200 text-slate-700 hover:bg-slate-50 py-2.5 rounded-lg text-[15px] font-semibold transition-colors"
              >
                Allow This Time
              </button>
              <button
                onClick={() => choose('deny')}
                className="w-full text-slate-500 hover:text-slate-700 py-2 rounded-lg text-[15px] font-medium transition-colors"
              >
                Deny
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
