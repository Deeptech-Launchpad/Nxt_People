import React, { useState, useEffect, useCallback } from 'react';
import { Clock, MapPin, CheckCircle, LogIn, LogOut, Navigation, AlertTriangle, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAttendance } from '../../context/AttendanceContext';
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
  const { record, loading, actionLoading, isCheckedIn, isCheckedOut, checkIn, checkOut } = useAttendance();
  const [time, setTime] = useState(new Date());
  const [gpsWarning, setGpsWarning] = useState(null);
  const { position, gpsError, gpsLoading, refresh: refreshGps } = useGeolocation();

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

  const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = time.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="max-w-2xl mx-auto space-y-5">
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
              <p className="text-brand-200 text-xs mt-0.5">{timeStr.split(' ')[1]}</p>
            </div>
          </div>
          <p className="text-slate-700 font-semibold">{dateStr}</p>

          {/* Work Mode Status */}
          <div className="flex items-center justify-center gap-2 mt-3 text-xs px-3 py-1.5 rounded-full w-fit mx-auto border bg-blue-50 border-blue-200 text-blue-700">
            <MapPin size={11} /> Work Mode: Office
          </div>
        </div>
      </div>


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
                ['Check In', record?.checkIn ? new Date(record.checkIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'],
                ['Check Out', record?.checkOut ? new Date(record.checkOut).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'],
                ['Work Hours', workingHours || (isCheckedIn ? 'In Progress' : '—')],
              ].map(([label, val]) => (
                <div key={label} className="text-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-xs text-slate-400 mb-1.5">{label}</p>
                  <p className="font-semibold text-slate-700 text-sm">{val}</p>
                </div>
              ))}
            </div>

            {/* Status badge */}
            {record?.status && (
              <div className={`flex items-center gap-2 justify-center mb-5 px-4 py-2 rounded-full text-sm font-semibold w-fit mx-auto border ${STATUS_COLORS[record.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                <CheckCircle size={14} /><span className="capitalize">{record.status}</span>
              </div>
            )}

            {/* Check-in button */}
            {!record?.checkIn && (
              <button onClick={handleCheckIn} disabled={actionLoading}
                className="w-full bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 text-lg transition-all shadow-lg shadow-brand-500/30 disabled:opacity-60 mb-3 active:scale-[0.99]">
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
                className="w-full bg-gradient-to-r from-rose-500 to-rose-400 hover:from-rose-400 hover:to-rose-300 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 text-lg transition-all shadow-lg shadow-rose-500/25 disabled:opacity-60 active:scale-[0.99]">
                {actionLoading ? (
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <><LogOut size={22} /><span>Check Out</span></>
                )}
              </button>
            )}

            {/* Day complete */}
            {isCheckedOut && (
              <div className="w-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold py-4 rounded-xl flex items-center justify-center gap-3 text-base">
                <CheckCircle size={20} /><span>Day Complete · {workingHours}</span>
              </div>
            )}

            {/* Live elapsed timer */}
            {isCheckedIn && (
              <p className="text-center text-xs text-slate-400 mt-3">
                Clocked in at {new Date(record.checkIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · {Math.floor((time - new Date(record.checkIn)) / 3600000)}h {Math.floor(((time - new Date(record.checkIn)) % 3600000) / 60000)}m elapsed
              </p>
            )}
          </>
        )}
      </div>

      {/* Policy info */}
      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
        <h3 className="font-display font-semibold text-slate-800 mb-3 text-sm">Attendance Policy</h3>
        <div className="space-y-2">
          {[['Standard Hours', '9:00 AM – 6:00 PM'], ['Grace Period', '15 minutes'], ['Late Mark', 'After 9:30 AM'], ['Half Day', 'Less than 4 hours'], ['Work Mode', 'Office / Work From Home']].map(([k, v]) => (
            <div key={k} className="flex justify-between items-center py-1.5 border-b border-slate-50 last:border-0">
              <span className="text-slate-500 text-xs">{k}</span>
              <span className="text-slate-700 text-xs font-medium">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
