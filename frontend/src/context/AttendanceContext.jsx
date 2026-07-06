/**
 * AttendanceContext.jsx
 * Global state for check-in/check-out timer persistence across navigation.
 * Timer survives tab switches. On refresh, recalculates from DB check_in timestamp.
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { requestLocation } from '../utils/geoPermission';

const AttendanceContext = createContext();

export const useAttendance = () => useContext(AttendanceContext);

export const AttendanceProvider = ({ children }) => {
  const { user } = useAuth();
  const [record, setRecord]           = useState(null);   // today's attendance record
  const [loading, setLoading]         = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [elapsed, setElapsed]         = useState(0);      // seconds elapsed
  // loadError lets consumers (Dashboard, MyAttendance) render a banner
  // when /attendance/today fails — previously the call silently dropped
  // to `record=null` and the UI showed stale state with no signal.
  const [loadError, setLoadError]     = useState(null);
  const timerRef = useRef(null);
  const currentDateRef = useRef(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));

  /* ── Start/restart the live timer ─────────────────────────────── */
  const startTimer = useCallback((checkInTime, baseSeconds = 0) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const tick = () => {
      const s = baseSeconds + Math.max(0, Math.floor((Date.now() - new Date(checkInTime).getTime()) / 1000));
      setElapsed(s);
    };
    tick(); // Set immediately to avoid 1s delay
    timerRef.current = setInterval(tick, 1000);
  }, []);

  /* ── Stop the timer ────────────────────────────────────────────── */
  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

   /* ── Fetch today's record on mount and when user changes ────────── */
    useEffect(() => {
      const token = localStorage.getItem('nxt_token');
      if (!token) { 
        setRecord(null);
        setElapsed(0);
        setLoading(false);
        return; 
      }

      setLoadError(null);
      api.get('/attendance/today')
        .then(r => {
          const rec = r.data.data;
          setRecord(rec);
          if (rec?.checkIn && !rec?.checkOut) {
            // Include any previously worked hours today as base for cumulative timer
            const baseHours = parseFloat(rec.workingHours || 0);
            const baseSeconds = Math.round(baseHours * 3600);
            startTimer(rec.checkIn, baseSeconds);
          } else if (rec?.checkOut) {
            // Show total worked hours (static, no live tick)
            const prev = parseFloat(rec.workingHours || 0);
            setElapsed(Math.round(prev * 3600));
            stopTimer();
          } else {
            stopTimer();
            setElapsed(0);
          }
        })
        .catch((err) => {
          setRecord(null);
          setElapsed(0);
          // Surface the failure so consumers can render a "couldn't load
          // today's attendance — try refresh" banner instead of pretending
          // the user simply hasn't checked in.
          setLoadError(err?.response?.data?.message || err?.message || 'Failed to load attendance');
        })
        .finally(() => setLoading(false));

      return () => stopTimer();
    }, [user?._id]); // Re-fetch when user changes

  /* ── Re-fetch when IST date rolls over (app kept open overnight) ─── */
  useEffect(() => {
    const id = setInterval(() => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (today === currentDateRef.current) return;
      currentDateRef.current = today;
      stopTimer();
      setRecord(null);
      setElapsed(0);
      api.get('/attendance/today')
        .then(r => {
          const rec = r.data.data;
          setRecord(rec);
          if (rec?.checkIn && !rec?.checkOut) {
            startTimer(rec.checkIn, Math.round(parseFloat(rec.workingHours || 0) * 3600));
          } else if (rec?.checkOut) {
            setElapsed(Math.round(parseFloat(rec.workingHours || 0) * 3600));
            stopTimer();
          }
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, [stopTimer, startTimer]);

  /* ── Additive location log ──────────────────────────────────────────
     Records where the check-in/out happened to the location-history table.
     Fire-and-forget: a failure here must NEVER break the attendance flow. */
  const logLocation = (type, coords, permissionStatus) => {
    api.post('/attendance/location', {
      type,
      latitude:  coords?.latitude  ?? null,
      longitude: coords?.longitude ?? null,
      accuracy:  coords?.accuracy  ?? null,
      location: 'Office',
      permissionStatus,
    }).catch(() => { /* additive — ignore */ });
  };

  /* ── Check In ─────────────────────────────────────────────────── */
   const checkIn = async () => {
     setActionLoading(true);
     try {
       // App-level consent + GPS capture (Allow Always / This Time / Deny).
       // GPS stays optional for check-in itself — backend warns if required.
       const { coords, permissionStatus } = await requestLocation();
       if (permissionStatus === 'browser_denied') {
         toast.error('Location is blocked. Click the lock icon in the address bar → Location → Allow, then try again.', { duration: 7000 });
         return;
       }
       const r = await api.post('/attendance/checkin', {
         location: 'Office',
         latitude:  coords?.latitude  ?? null,
         longitude: coords?.longitude ?? null,
       });
       const rec = r.data.data;
       setRecord(rec);
       logLocation('checkin', coords, permissionStatus);

       // Include any previously worked hours today (cumulative timer)
       const prevHours = parseFloat(rec.workingHours || 0);
       const baseSeconds = Math.round(prevHours * 3600);
       startTimer(rec.checkIn, baseSeconds);

       toast.success(r.data.lateMessage || 'Checked in successfully!');
       return rec;
     } catch (err) {
       toast.error(err.response?.data?.message || 'Check-in failed');
       throw err;
     } finally { setActionLoading(false); }
   };

  /* ── Check Out ────────────────────────────────────────────────── */
  const checkOut = async () => {
    setActionLoading(true);
    try {
      const { coords, permissionStatus } = await requestLocation();
      if (permissionStatus === 'browser_denied') {
        toast.error('Location is blocked. Click the lock icon in the address bar → Location → Allow, then try again.', { duration: 7000 });
        return;
      }
      const r = await api.post('/attendance/checkout', {
        location: 'Office',
        latitude:  coords?.latitude  ?? null,
        longitude: coords?.longitude ?? null,
      });
      const rec = r.data.data;
      setRecord(rec);
      logLocation('checkout', coords, permissionStatus);
      stopTimer();
      // Set elapsed to total worked hours
      const prev = parseFloat(rec.workingHours || 0);
      setElapsed(Math.round(prev * 3600));
      toast.success('Checked out successfully!');
      return rec;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Check-out failed');
      throw err;
    } finally { setActionLoading(false); }
  };

  /* ── Computed values ────────────────────────────────────────────── */
  const isCheckedIn  = !!(record?.checkIn && !record?.checkOut);
  const isCheckedOut = !!record?.checkOut;

  const hrs  = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  const timerDisplay = `${hrs} : ${mins} : ${secs}`;

  return (
    <AttendanceContext.Provider value={{
      record, loading, actionLoading, elapsed, isCheckedIn, isCheckedOut,
      timerDisplay, hrs, mins, secs, loadError,
      checkIn, checkOut, setRecord,
    }}>
      {children}
    </AttendanceContext.Provider>
  );
};
