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

const TZ = 'Asia/Kolkata';
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

/* Past this, a session is not live — somebody forgot to check out. Ticking on
 * to 26:00:00 states something false and, worse, hides the fact that the day
 * needs regularizing. 18h clears the longest real shift including overtime. */
const STALE_SESSION_HOURS = 18;

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
  /* True when the open session is too old to be real — the person forgot to
   * check out. Consumers use it to prompt for regularization instead of
   * showing a clock nobody should trust. */
  const [forgotCheckout, setForgotCheckout] = useState(false);
  const timerRef = useRef(null);
  const currentDateRef = useRef(todayStr());

  /* ── Start/restart the live timer ─────────────────────────────── */
  /* Takes the whole record and works out both halves itself.
   *
   * It used to take a start time and a base, and every caller decided which
   * start time to pass. Two of them did, one was corrected and the other was
   * not, so re-checking in still counted from the day's arrival on top of the
   * hours already banked: 34 minutes worked, back at the desk, and the clock
   * read 1:07 immediately. Deriving it here means a third caller cannot get it
   * wrong.
   *
   * checkIn is when they arrived and is what lateness is measured from.
   * sessionStartedAt is when the current stretch began — the same instant on a
   * day with one stretch, and the only correct basis on a day with more. */
  const startTimer = useCallback((rec) => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!rec?.checkIn) return;

    /* Two guards, both against the same failure: a clock counting from a punch
     * that is not today's.
     *
     * The record now carries the day it is about, so a body that arrived from
     * a cache instead of the network is recognisable. This is what employees
     * were hitting — restore the browser the next morning and the timer picked
     * up yesterday's check-in and ran, until a hard refresh. Nobody should
     * have to know that. The date makes the stale body inert. */
    if (rec.date && rec.date !== todayStr()) {
      setElapsed(0);
      setForgotCheckout(false);
      return;
    }

    const from = new Date(rec.sessionStartedAt || rec.checkIn).getTime();
    const baseSeconds = Math.round((parseFloat(rec.workingHours) || 0) * 3600);

    /* And the belt: even a today-dated session stops being credible after
     * STALE_SESSION_HOURS. Freeze it rather than run on, and say why. */
    if (Date.now() - from > STALE_SESSION_HOURS * 3600 * 1000) {
      setElapsed(baseSeconds);
      setForgotCheckout(true);
      return;
    }

    setForgotCheckout(false);
    const tick = () => {
      setElapsed(baseSeconds + Math.max(0, Math.floor((Date.now() - from) / 1000)));
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

        /* The day the SERVER answered for, checked against the day the device
         * thinks it is. A response replayed from the browser's cache is the
         * one case where these disagree, and it is the case that had people
         * hard-refreshing every morning. Discard it: the record shown is then
         * "not checked in", which is both true for today and recoverable —
         * pressing Check In goes to the server, which is the real authority. */
        const serverDay = r.data.date || rec?.date;
        if (serverDay && serverDay !== todayStr()) {
          stopTimer();
          setRecord(null);
          setElapsed(0);
          setForgotCheckout(false);
          return;
        }

        setRecord(rec);
        if (rec?.checkIn && !rec?.checkOut) {
          startTimer(rec);
        } else if (rec?.checkOut) {
          // Show total worked hours (static, no live tick)
          setElapsed(Math.round(parseFloat(rec.workingHours || 0) * 3600));
          setForgotCheckout(false);
          stopTimer();
        } else {
          stopTimer();
          setElapsed(0);
          setForgotCheckout(false);
        }
      })
      .catch((err) => {
        stopTimer();
        setRecord(null);
        setElapsed(0);
        setForgotCheckout(false);
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
      const today = todayStr();
      if (today !== currentDateRef.current) {
        currentDateRef.current = today;
        stopTimer();
        setRecord(null);
        setElapsed(0);
        setForgotCheckout(false);
      }
      refresh();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };

    /* The page being restored, which is the journey people actually described:
     * close the browser, shut down, open it the next day, let it restore the
     * tabs. `persisted` marks a restore from the back/forward cache, where the
     * whole page comes back frozen mid-tick. visibilitychange covers this on
     * desktop Chrome; Safari and iOS restore WITHOUT firing it, so phones were
     * relying on nothing at all. pageshow fires on every one of them. */
    const onPageShow = (e) => { if (e.persisted) resync(); };

    const id = setInterval(() => {
      if (todayStr() !== currentDateRef.current) resync();
    }, 60000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onPageShow);
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

      startTimer(rec);
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
      timerDisplay, hrs, mins, secs, loadError, forgotCheckout,
      checkIn, checkOut, setRecord,
    }}>
      {children}
    </AttendanceContext.Provider>
  );
};
