import React, { useState, useEffect, useCallback } from 'react';
import { Clock, MapPin, CheckCircle, LogIn, LogOut, Navigation, AlertTriangle, Wifi, WifiOff, Building2, Home, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAttendance } from '../../context/AttendanceContext';
import api from '../../utils/api';
import { reverseGeocode } from '../../utils/reverseGeocode';
import BackButton from '../../components/BackButton';

function useGeolocation() {
  const [position, setPosition] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  const getPosition = useCallback(() => {
    if (!navigator.geolocation) { setGpsError('Geolocation not supported by your browser'); return; }
    setGpsLoading(true); setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setPosition({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }); setGpsLoading(false); },
      (err) => { setGpsError(err.message || 'Location unavailable'); setGpsLoading(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, []);

  useEffect(() => { getPosition(); }, [getPosition]);
  return { position, gpsError, gpsLoading, refresh: getPosition };
}

const STATUS_COLORS = { present: 'text-emerald-600 bg-emerald-50 border-emerald-100', late: 'text-amber-600 bg-amber-50 border-amber-100', 'half-day': 'text-blue-600 bg-blue-50 border-blue-100', absent: 'text-red-600 bg-red-50 border-red-100' };

export default function CheckInOut() {
  const { user } = useAuth();
  // Read + mutate attendance through the shared context so other pages
  // (Home dashboard, top-bar avatar, calendar) refresh in lockstep when
  // we check in/out from this page. Was previously calling the API
  // directly and only updating local state, which left Dashboard's
  // useAttendance() hook stale.
  const { record, loading, actionLoading, isCheckedIn, isCheckedOut, checkIn, checkOut, elapsed, forgotCheckout } = useAttendance();
  const [time, setTime] = useState(new Date());
  const [gpsWarning, setGpsWarning] = useState(null);
  const { position, gpsError, gpsLoading, refresh: refreshGps } = useGeolocation();

  /* Work Mode, as the SERVER recorded it.
   *
   * This used to reverse-geocode the browser's position to a place name and
   * string-match it against a configured keyword. The keyword was never set,
   * so it read "Not configured" for everybody — and even configured, a label
   * derived in the browser could disagree with the mode stored on the row.
   * The record is the answer; this states it. */
  const workMode = record?.workMode || null;
  const workModeDetail = record?.workLocationName
    || (record?.locationDistance != null ? `${record.locationDistance} m from the nearest office` : null);

  /* The place name is still resolved for the location line, which is a human
   * courtesy and not a decision about anybody's day. */
  const [place, setPlace] = useState(undefined);
  useEffect(() => {
    if (!position) return;
    setPlace(undefined);
    let cancelled = false;
    reverseGeocode(position.latitude, position.longitude).then(name => { if (!cancelled) setPlace(name ?? null); });
    return () => { cancelled = true; };
  }, [position]);

  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

  const handleCheckIn = async () => {
    setGpsWarning(null);
    try {
      await checkIn();
      // checkIn() in the context already toasts success. Nothing else to do —
      // the context will broadcast the updated record to every consumer.
    } catch (err) {
      // The context handles its own error toast; we just stay quiet here.
      if (err.response?.data?.gpsWarning) setGpsWarning(err.response.data.gpsWarning);
    }
  };

  const handleCheckOut = async () => {
    try {
      await checkOut();
    } catch (_) { /* context toasts the error */ }
  };
  const workingHours = record?.workingHours ? `${Math.floor(record.workingHours)}h ${Math.round((record.workingHours % 1) * 60)}m` : null;

  const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' });
  const dateStr = time.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' });

  return (
    <div className="p-5 max-w-2xl mx-auto space-y-5">
      <div className="pt-5 pb-1">
        <BackButton to="/attendance" label="Attendance" />
      </div>
      {/* Clock card */}
      <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50/50 to-transparent pointer-events-none" />
        <div className="relative">
          <div className="w-36 h-36 mx-auto rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mb-5 shadow-xl shadow-brand-500/30">
            <div className="text-center">
              <p className="font-display font-bold text-white text-xl leading-none">{timeStr.split(' ')[0]}</p>
              <p className="text-brand-200 text-sm mt-0.5">{timeStr.split(' ')[1]}</p>
            </div>
          </div>
          <p className="text-slate-700 font-semibold">{dateStr}</p>

          {/* Work Mode Status — derived from the live GPS fix, mirrors AttendanceLocation.jsx */}
          <div className={`flex items-center justify-center gap-2 mt-3 text-sm px-3 py-1.5 rounded-full w-fit mx-auto border ${
            workMode === 'office' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
            workMode === 'wfh'    ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                     'bg-slate-50 border-slate-200 text-slate-500'
          }`}>
            {workMode === 'office' ? <Building2 size={11} /> : workMode === 'wfh' ? <Home size={11} /> : <MapPin size={11} />}
            Work Mode: {
              workMode === 'office'  ? 'Office' :
              workMode === 'wfh'     ? 'Work From Home' :
              workMode === 'unknown' ? 'Not recorded' :
              !record?.checkIn       ? 'Set on check-in' : 'Not classified'
            }
            {workModeDetail && workMode && workMode !== 'unknown' && (
              <span className="opacity-70">· {workModeDetail}</span>
            )}
          </div>
        </div>
      </div>

      {/* Why a punch could not be placed, to the person it happened to.
          They see "Not recorded" otherwise and have no idea whether that is
          their doing, their phone's, or a fault. Each cause has a different
          thing to try. */}
      {workMode === 'unknown' && (
        <div className="bg-slate-50 border border-slate-200 text-slate-600 rounded-2xl px-4 py-3 flex items-start gap-3 text-sm">
          <MapPin size={16} className="flex-shrink-0 mt-0.5 text-slate-400" />
          <span>
            {!record?.hasCoords
              ? 'Your check-in was recorded, but your location was not shared — so it could not be marked as office or work from home. Allow location for this site and check in from your phone next time.'
              : record?.locationAccuracy
                ? `Your check-in was recorded, but your device could only place you to within ${record.locationAccuracy} m, which is too vague to tell office from home. A phone with GPS gives a much tighter fix than a desktop.`
                : 'Your check-in was recorded, but it could not be placed as office or work from home.'}
          </span>
        </div>
      )}

      {/* GPS status banner — surfaces denial/timeout instead of failing silently */}
      {gpsError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-3 flex items-center gap-3 text-sm">
          <WifiOff size={16} className="flex-shrink-0" />
          <span className="flex-1">Location unavailable: {gpsError}. Check-in will still work, but Work Mode can't be detected.</span>
          <button onClick={refreshGps} className="flex items-center gap-1 font-semibold text-amber-700 hover:text-amber-900 flex-shrink-0">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}
      {gpsWarning && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl px-4 py-3 flex items-center gap-3 text-sm">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>{gpsWarning}</span>
        </div>
      )}


      {/* Attendance card */}
      <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
        <h3 className="font-display font-semibold text-slate-800 mb-5">Today's Attendance</h3>
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <>
            {/* Times grid */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                ['Check In', (record?.sessions?.[0]?.checkIn || record?.checkIn) ? new Date(record?.sessions?.[0]?.checkIn || record.checkIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'],
                ['Check Out', record?.checkOut ? new Date(record.checkOut).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'],
                ['Work Hours', workingHours || (isCheckedIn ? 'In Progress' : '—')],
              ].map(([label, val]) => (
                <div key={label} className="text-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-sm text-slate-400 mb-1.5">{label}</p>
                  <p className="font-semibold text-slate-700 text-base">{val}</p>
                </div>
              ))}
            </div>

            {/* Status badge */}
            {record?.status && (
              <div className={`flex items-center gap-2 justify-center mb-5 px-4 py-2 rounded-full text-base font-semibold w-fit mx-auto border ${STATUS_COLORS[record.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                <CheckCircle size={14} /><span className="capitalize">{record.status}</span>
              </div>
            )}

            {/* Check-in button */}
            {!record?.checkIn && (
              <button onClick={handleCheckIn} disabled={actionLoading}
                className="w-full bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 text-xl transition-all shadow-lg shadow-brand-500/30 disabled:opacity-60 mb-3 active:scale-[0.99]">
                {actionLoading ? (
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <><LogIn size={22} /><span>Check In</span></>
                )}
              </button>
            )}

            {/* Check-out button */}
            {isCheckedIn && (
              <button onClick={handleCheckOut} disabled={actionLoading}
                className="w-full bg-gradient-to-r from-rose-500 to-rose-400 hover:from-rose-400 hover:to-rose-300 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 text-xl transition-all shadow-lg shadow-rose-500/25 disabled:opacity-60 active:scale-[0.99]">
                {actionLoading ? (
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <><LogOut size={22} /><span>Check Out</span></>
                )}
              </button>
            )}

            {/* Day complete */}
            {isCheckedOut && (
              <div className="w-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold py-4 rounded-xl flex items-center justify-center gap-3 text-lg">
                <CheckCircle size={20} /><span>Day Complete · {workingHours}</span>
              </div>
            )}

            {/* Live elapsed timer */}
            {isCheckedIn && !forgotCheckout && (
              <p className="text-center text-sm text-slate-400 mt-3">
                Clocked in at {new Date(record?.sessions?.[0]?.checkIn || record.checkIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · {Math.floor(elapsed / 3600)}h {Math.floor((elapsed % 3600) / 60)}m worked today
              </p>
            )}

            {/* The session stopped being credible hours ago. The clock is
                frozen rather than running on, so say why — a stuck timer with
                no explanation is what sent people looking for a refresh. */}
            {isCheckedIn && forgotCheckout && (
              <p className="text-center text-sm text-amber-600 mt-3">
                Still open from {new Date(record?.sessions?.[0]?.checkIn || record.checkIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} — it looks like the check-out was missed.
                Check out now to close the day, or raise a regularization to correct the time.
              </p>
            )}

            {/* Sessions list */}
            {record?.sessions && record.sessions.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {record.sessions.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                    <span className="text-slate-500 font-medium">Session {i + 1}</span>
                    <span className="text-slate-700">
                      {new Date(s.checkIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                      {' → '}
                      {s.checkOut ? new Date(s.checkOut).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : <span className="text-emerald-600">Active</span>}
                    </span>
                    {parseFloat(s.sessionHours) > 0 && (
                      <span className="text-slate-400 text-xs">{Math.floor(s.sessionHours)}h {Math.round((s.sessionHours % 1) * 60)}m</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Policy info */}
      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
        <h3 className="font-display font-semibold text-slate-800 mb-3 text-base">Attendance Policy</h3>
        <div className="space-y-2">
          {[['Standard Hours', '9:00 AM – 6:00 PM'], ['Grace Period', '15 minutes'], ['Late Mark', 'After 9:30 AM'], ['Half Day', 'Less than 4 hours'], ['Work Mode', 'Office / Work From Home']].map(([k, v]) => (
            <div key={k} className="flex justify-between items-center py-1.5 border-b border-slate-50 last:border-0">
              <span className="text-slate-500 text-sm">{k}</span>
              <span className="text-slate-700 text-sm font-medium">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
