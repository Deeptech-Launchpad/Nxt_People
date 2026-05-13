/**
 * AttendanceContext.jsx
 * Global state for check-in/check-out timer persistence across navigation.
 * Timer survives tab switches. On refresh, recalculates from DB check_in timestamp.
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';

const AttendanceContext = createContext();

export const useAttendance = () => useContext(AttendanceContext);

export const AttendanceProvider = ({ children }) => {
  const { user } = useAuth();
  const [record, setRecord]           = useState(null);   // today's attendance record
  const [loading, setLoading]         = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [elapsed, setElapsed]         = useState(0);      // seconds elapsed
  const timerRef = useRef(null);

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
          }
        })
        .catch(() => {
          setRecord(null);
          setElapsed(0);
        })
        .finally(() => setLoading(false));

      return () => stopTimer();
    }, [user?._id]); // Re-fetch when user changes

  /* ── GPS helper ─────────────────────────────────────────────────── */
  const getPosition = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
  });

  /* ── Check In ─────────────────────────────────────────────────── */
   const checkIn = async () => {
     setActionLoading(true);
     try {
       let coords = { latitude: null, longitude: null };
       try {
         const pos = await getPosition();
         coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
       } catch (_) {
         // GPS optional — backend will warn if required
       }
       const r = await api.post('/attendance/checkin', { location: 'Office', ...coords });
       const rec = r.data.data;
       setRecord(rec);
       
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
      let coords = { latitude: null, longitude: null };
      try {
        const pos = await getPosition();
        coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      } catch (_) {}
      const r = await api.post('/attendance/checkout', { location: 'Office', ...coords });
      const rec = r.data.data;
      setRecord(rec);
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
      timerDisplay, hrs, mins, secs,
      checkIn, checkOut, setRecord,
    }}>
      {children}
    </AttendanceContext.Provider>
  );
};
