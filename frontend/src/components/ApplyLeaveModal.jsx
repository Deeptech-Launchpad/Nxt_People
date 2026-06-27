import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { MapPin, Clock, LogIn, LogOut, ChevronDown, Calendar, Star, DollarSign, Activity, Rss, FileText } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (s) => s?.toFixed ? s.toFixed(2) : s;
const fmtINR = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
const fmtTime = (secs) => {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
};
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Live Timer Hook ───────────────────────────────────────────────────────────
function useCheckInTimer(record) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = localStorage.getItem('nxt_checkin_start');
    if (start && record?.checkIn && !record?.checkOut) {
      const base = Math.floor((Date.now() - Number(start)) / 1000);
      setSecs(Math.max(0, base));
      const id = setInterval(() => setSecs(p => p + 1), 1000);
      return () => clearInterval(id);
    } else {
      setSecs(0);
    }
  }, [record]);
  return secs;
}

// ── GPS ───────────────────────────────────────────────────────────────────────
function getGPS() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('GPS not supported'));
    navigator.geolocation.getCurrentPosition(
      p => res({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => rej(new Error('Location denied. Please enable GPS.'))
    );
  });
}

// ── Apply Leave Modal ─────────────────────────────────────────────────────────
function ApplyLeaveModal({ onClose, onSuccess, leaveTypes }) {
  const [form, setForm] = useState({ leaveType: leaveTypes?.[0]?.code || 'casual', startDate: '', endDate: '', reason: '', isHalfDay: false, startTime: '', endTime: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isPermission = form.leaveType === 'permission';
  // Permission is hourly: derive hours from the time window for a live hint.
  const permHours = (() => {
    if (!isPermission || !form.startTime || !form.endTime) return 0;
    const m = (t) => { const [h, mm] = t.split(':').map(Number); return (h || 0) * 60 + (mm || 0); };
    return Math.max(0, (m(form.endTime) - m(form.startTime)) / 60);
  })();
  const submit = async (e) => {
    e.preventDefault();
    if (isPermission) {
      if (!form.startDate) { toast.error('Please select a date for the permission request.'); return; }
      if (!form.startTime) { toast.error('Please select a start time for the permission request.'); return; }
      if (!form.endTime)   { toast.error('Please select an end time for the permission request.'); return; }
      if (form.endTime <= form.startTime) { toast.error('End time must be after start time.'); return; }
    } else {
      if (!form.startDate) { toast.error('Please select a start date.'); return; }
      if (!form.endDate)   { toast.error('Please select an end date.'); return; }
    }
    setSaving(true);
    try {
      // Permission posts a single date + start/end time; the backend computes
      // hours and enforces the 4h monthly cap.
      const payload = isPermission
        ? { leaveType: form.leaveType, startDate: form.startDate, endDate: form.startDate, reason: form.reason, startTime: form.startTime, endTime: form.endTime }
        : form;
      await api.post('/leaves', payload);
      toast.success(isPermission ? 'Permission applied!' : 'Leave applied!'); onSuccess();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <h3 className="text-[15px] font-bold text-slate-800 mb-4">{isPermission ? 'Apply Permission' : 'Apply Leave'}</h3>
        <form onSubmit={submit} className="space-y-3">
          <select value={form.leaveType} onChange={e => set('leaveType', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400">
            {(leaveTypes || []).map(lt => <option key={lt.code} value={lt.code}>{lt.name}{lt.code === 'permission' ? ` (${lt.available ?? 0}h left this month)` : (lt.available != null ? ` (${lt.available} avail.)` : '')}</option>)}
          </select>
          {isPermission ? (
            <>
              <div><label className="text-[11px] text-slate-500">Date</label><input type="date" required value={form.startDate} onChange={e => set('startDate', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400"/></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[11px] text-slate-500">Start time</label><input type="time" required value={form.startTime} onChange={e => set('startTime', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400"/></div>
                <div><label className="text-[11px] text-slate-500">End time</label><input type="time" required value={form.endTime} onChange={e => set('endTime', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400"/></div>
              </div>
              {permHours > 0 && <p className={`text-[12px] font-medium ${permHours > 4 ? 'text-red-600' : 'text-purple-600'}`}>{permHours.toFixed(2)}h{permHours > 4 ? ' — exceeds the 4h limit' : ''}</p>}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[11px] text-slate-500">From</label><input type="date" required value={form.startDate} onChange={e => set('startDate', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400"/></div>
                <div><label className="text-[11px] text-slate-500">To</label><input type="date" required value={form.endDate} onChange={e => set('endDate', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400"/></div>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer">
                <input type="checkbox" checked={form.isHalfDay} onChange={e => set('isHalfDay', e.target.checked)} className="rounded"/> Half Day
              </label>
            </>
          )}
          <textarea required rows={3} placeholder="Reason" value={form.reason} onChange={e => set('reason', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400 resize-none"/>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-[13px] font-semibold disabled:opacity-60">{saving ? 'Submitting…' : 'Submit'}</button>
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 rounded-lg py-2 text-[13px] text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ApplyLeaveModal;
