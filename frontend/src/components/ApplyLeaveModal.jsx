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
  const [form, setForm] = useState({ leaveType: leaveTypes?.[0]?.code || 'casual', startDate: '', endDate: '', reason: '', isHalfDay: false });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/leaves', form);
      toast.success('Leave applied!'); onSuccess();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <h3 className="text-[15px] font-bold text-slate-800 mb-4">Apply Leave</h3>
        <form onSubmit={submit} className="space-y-3">
          <select value={form.leaveType} onChange={e => set('leaveType', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400">
            {(leaveTypes || []).map(lt => <option key={lt.code} value={lt.code}>{lt.name} ({lt.available} avail.)</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[11px] text-slate-500">From</label><input type="date" required value={form.startDate} onChange={e => set('startDate', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400"/></div>
            <div><label className="text-[11px] text-slate-500">To</label><input type="date" required value={form.endDate} onChange={e => set('endDate', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400"/></div>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer">
            <input type="checkbox" checked={form.isHalfDay} onChange={e => set('isHalfDay', e.target.checked)} className="rounded"/> Half Day
          </label>
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
