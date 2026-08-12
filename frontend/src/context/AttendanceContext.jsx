/**
 * AttendanceContext.jsx
 * Global state for check-in/check-out timer persistence across navigation.
 * Timer survives tab switches. On refresh, recalculates from DB check_in timestamp.
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { startLocationCapture } from '../utils/geoPermission';

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

  /* ── Load today's record (shared by mount, date rollover, and refocus) ── */
  const refresh = useCallback(() => {
    const token = localStorage.getItem('nxt_token');
    if (!token) {
      stopTimer();
      setRecord(null);
      setElapsed(0);
      setLoading(false);
      return Promise.resolve();
    }

    setLoadError(null);
    return api.get('/attendance/today')
      .then(r => {
        const rec = r.data.data;
        setRecord(rec);
        if (rec?.checkIn && !rec?.checkOut) {
          // Include any previously worked hours today as base for cumulative timer
          const baseSeconds = Math.round(parseFloat(rec.workingHours || 0) * 3600);
          startTimer(rec.checkIn, baseSeconds);
        } else if (rec?.checkOut) {
          // Show total worked hours (static, no live tick)
          setElapsed(Math.round(parseFloat(rec.workingHours || 0) * 3600));
          stopTimer();
        } else {
          stopTimer();
          setElapsed(0);
        }
      })
      .catch((err) => {
        stopTimer();
        setRecord(null);
        setElapsed(0);
        // Surface the failure so consumers can render a "couldn't load
        // today's attendance — try refresh" banner instead of pretending
        // the user simply hasn't checked in.
        setLoadError(err?.response?.data?.message || err?.message || 'Failed to load attendance');
      })
      .finally(() => setLoading(false));
  }, [startTimer, stopTimer]);

  /* ── Fetch today's record on mount and when user changes ────────── */
  useEffect(() => {
    refresh();
    return () => stopTimer();
  }, [user?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Re-sync on date rollover AND on regaining focus ───────────────
     /attendance/today only ever returns the row for the day it's asked
     about, so a tab left open overnight keeps live-ticking yesterday's
     check-in — a check-in at 10:15 still reads "24:16:28" the next
     morning. A 60s interval alone can't fix that: a slept or frozen tab
     fires no timers at all, so the stale timer stays on screen until the
     tab wakes. Re-syncing on visibilitychange/focus catches exactly that
     case, which previously only a manual reload could clear. */
  useEffect(() => {
    const resync = () => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (today !== currentDateRef.current) {
        currentDateRef.current = today;
        stopTimer();
        setRecord(null);
        setElapsed(0);
      }
      refresh();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    const id = setInterval(() => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (today !== currentDateRef.current) resync();
    }, 60000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh, stopTimer]);

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

  /* ── Location consent + GPS, entirely off the attendance critical path ──
     Consent is a modal the user may never answer, and awaiting it before
     the punch meant a pending (or invisible, or orphaned) prompt silently
     swallowed the whole check-in/check-out: the request was never sent, the
     button spun forever, and the day was left open — which the nightly cron
     then marked Absent. A browser-level location block was even worse: it
     returned early and refused to record attendance at all, even though the
     backend happily accepts GPS-less punches unless require_gps is set.

     Attendance is now recorded first; location is patched on afterwards if
     and when consent and a fix arrive. Location is additive, so every
     failure here stays silent rather than surfacing as an attendance error. */
  const captureLocationInBackground = (type) => {
    Promise.resolve()
      .then(() => startLocationCapture())
      .then(({ gpsPromise, permissionStatus }) => {
        if (permissionStatus === 'browser_denied') return;
        return gpsPromise.then(coords => {
          if (!coords) return;
          api.patch('/attendance/location', { type, latitude: coords.latitude, longitude: coords.longitude }).catch(() => {});
          logLocation(type, coords, permissionStatus);
        });
      })
      .catch(() => { /* additive — never breaks the punch */ });
  };

  /* ── Check In ─────────────────────────────────────────────────── */
  const checkIn = async () => {
    setActionLoading(true);
    try {
      const r = await api.post('/attendance/checkin', { location: 'Office', latitude: null, longitude: null });
      const rec = r.data.data;
      setRecord(rec);

      const baseSeconds = Math.round(parseFloat(rec.workingHours || 0) * 3600);
      startTimer(rec.checkIn, baseSeconds);
      toast.success(r.data.lateMessage || 'Checked in successfully!');

      captureLocationInBackground('checkin');
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
      const r = await api.post('/attendance/checkout', { location: 'Office', latitude: null, longitude: null });
      const rec = r.data.data;
      setRecord(rec);
      stopTimer();
      setElapsed(Math.round(parseFloat(rec.workingHours || 0) * 3600));
      toast.success('Checked out successfully!');

      captureLocationInBackground('checkout');
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
