/**
 * LeaveSummary.jsx — Leave Tracker / Leave Summary
 * Matches screenshot: 4 leave type cards + Apply Leave modal + Upcoming/Past holidays section
 */
import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Clock, Plus, X, Info, ChevronDown, AlertTriangle, Eye } from 'lucide-react';
import api from '../../utils/api';
import { confirmCancel } from '../../utils/cancelLeave';
import BackButton from '../../components/BackButton';
import toast from 'react-hot-toast';
import LeaveDetailModal from '../../components/LeaveDetailModal';

/* ── helpers ────────────────────────────────────────────────────────── */
function fmtDate(s) {
  if (!s) return '';
  const d = typeof s === 'string' && !s.includes('T') ? new Date(s + 'T00:00:00') : new Date(s);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateLong(s) {
  if (!s) return '';
  const d = typeof s === 'string' && !s.includes('T') ? new Date(s + 'T00:00:00') : new Date(s);
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}
function countWorkingDays(from, to, holidays = []) {
  if (!from || !to) return 0;
  const holidaySet = new Set((holidays || []).map(h => new Date(h.date).toLocaleDateString('en-CA')));
  let count = 0;
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6 && !holidaySet.has(cur.toLocaleDateString('en-CA'))) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/* ── Apply Leave Modal ───────────────────────────────────────────────── */
function ApplyLeaveModal({ cards, holidays, onClose, onSubmitted }) {
  const [form, setForm] = useState({
    leaveType: cards[0]?.code || 'casual',
    fromDate: '',
    toDate: '',
    reason: '',
    isHalfDay: false,
    halfDayType: 'first_half',
    teamEmail: '',
    startTime: '',
    endTime: '',
  });
  const [loading, setLoading] = useState(false);
  const [workingDays, setWorkingDays] = useState(0);

  const selectedCard = cards.find(c => c.code === form.leaveType);
  const isPermission = form.leaveType === 'permission';
  // Permission is hourly — derive hours from the chosen time window.
  const permHours = (() => {
    if (!isPermission || !form.startTime || !form.endTime) return 0;
    const m = (t) => { const [h, mm] = t.split(':').map(Number); return (h || 0) * 60 + (mm || 0); };
    return Math.max(0, (m(form.endTime) - m(form.startTime)) / 60);
  })();
  const insufficientBalance = isPermission
    ? (permHours > 0 && permHours > (selectedCard?.available ?? 4))
    : (selectedCard?.available !== null && workingDays > 0 && workingDays > (selectedCard?.available || 0));

  useEffect(() => {
    if (isPermission) { setWorkingDays(0); return; }
    if (form.fromDate && form.toDate) {
      const days = form.isHalfDay ? 0.5 : countWorkingDays(form.fromDate, form.toDate, holidays);
      setWorkingDays(days);
    } else {
      setWorkingDays(0);
    }
  }, [form.fromDate, form.toDate, form.isHalfDay, isPermission, holidays]);

  // Close on ESC
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleSubmit = async e => {
    e.preventDefault();
    if (isPermission) {
      if (!form.fromDate) return toast.error('Please select a date');
      if (!form.startTime || !form.endTime) return toast.error('Please select start and end time');
      if (permHours <= 0) return toast.error('End time must be after start time');
      if (permHours > 4)  return toast.error('A single permission cannot exceed 4 hours');
      if (!form.reason.trim()) return toast.error('Reason is required');
      setLoading(true);
      try {
        await api.post('/leaves', {
          leaveType: 'permission',
          startDate: form.fromDate,
          endDate: form.fromDate,
          reason: form.reason,
          startTime: form.startTime,
          endTime: form.endTime,
          teamEmail: form.teamEmail,
        });
        toast.success('Permission applied successfully!');
        onSubmitted();
        onClose();
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to apply permission');
      } finally { setLoading(false); }
      return;
    }
    if (!form.fromDate) return toast.error('Please select From date');
    if (!form.toDate)   return toast.error('Please select To date');
    // Backend rejects this with a vague message — catch it client-side so
    // the user gets immediate feedback. Compare as ISO strings (YYYY-MM-DD
    // sorts lexicographically the same way as chronologically).
    if (form.toDate < form.fromDate) return toast.error('To date cannot be before From date');
    if (!form.reason.trim()) return toast.error('Reason is required');
    setLoading(true);
    try {
      await api.post('/leaves', {
        leaveType: form.leaveType,
        startDate: form.fromDate,
        endDate: form.toDate,
        reason: form.reason,
        isHalfDay: form.isHalfDay,
        halfDayType: form.halfDayType,
        teamEmail: form.teamEmail,
      });
      toast.success('Leave applied successfully!');
      onSubmitted();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to apply leave');
    } finally { setLoading(false); }
  };

  const LEAVE_COLORS = {
    casual: 'bg-amber-50 border-amber-200',
    comp_off: 'bg-green-50 border-green-200',
    unpaid: 'bg-gray-50 border-gray-200',
    permission: 'bg-purple-50 border-purple-200',
    sick: 'bg-red-50 border-red-200',
    earned: 'bg-blue-50 border-blue-200',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-[17px] font-bold text-[#1a2040]">Apply Leave</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Leave Type */}
          <div>
            <label className="block text-[14px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Leave Type *</label>
            <select
              value={form.leaveType}
              onChange={e => setForm({ ...form, leaveType: e.target.value })}
              className="w-full border border-gray-200 rounded px-3 py-2.5 text-[13.5px] text-gray-800 outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-blue-100 transition"
            >
              {cards.map(c => (
                <option key={c.code} value={c.code}>
                  {c.name}{c.code === 'permission' ? ` (${c.available ?? 0}h left this month)` : (c.available !== null ? ` (${c.available} available)` : '')}
                </option>
              ))}
            </select>
          </div>

          {/* Balance warning */}
          {insufficientBalance && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded px-3 py-2">
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
              <p className="text-[14px] text-red-600 font-medium">
                {isPermission
                  ? `Over the monthly limit. ${selectedCard?.available ?? 0}h left this month, requested ${permHours.toFixed(2)}h.`
                  : `Insufficient balance. Available: ${selectedCard?.available} days, Requested: ${workingDays} days.`}
              </p>
            </div>
          )}

          {isPermission ? (
            <>
              {/* Permission: single date + a start/end time window (hourly leave) */}
              <div>
                <label className="block text-[14px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Date *</label>
                <input type="date" value={form.fromDate}
                  onChange={e => setForm({ ...form, fromDate: e.target.value, toDate: e.target.value })}
                  className="w-full border border-gray-200 rounded px-3 py-2.5 text-[13.5px] outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-blue-100 transition" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[14px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Start Time *</label>
                  <input type="time" value={form.startTime}
                    onChange={e => setForm({ ...form, startTime: e.target.value })}
                    className="w-full border border-gray-200 rounded px-3 py-2.5 text-[13.5px] outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-blue-100 transition" />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">End Time *</label>
                  <input type="time" value={form.endTime}
                    onChange={e => setForm({ ...form, endTime: e.target.value })}
                    className="w-full border border-gray-200 rounded px-3 py-2.5 text-[13.5px] outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-blue-100 transition" />
                </div>
              </div>
              {permHours > 0 && (
                <div className={`flex items-center gap-2 rounded px-3 py-2 border ${permHours > 4 ? 'bg-red-50 border-red-200' : 'bg-purple-50 border-purple-200'}`}>
                  <Clock size={14} className={permHours > 4 ? 'text-red-500' : 'text-purple-500'} />
                  <p className={`text-[14px] font-semibold ${permHours > 4 ? 'text-red-700' : 'text-purple-700'}`}>
                    {permHours.toFixed(2)} hour{permHours !== 1 ? 's' : ''}{permHours > 4 ? ' — exceeds the 4h limit' : ` · ${Math.max(0, (selectedCard?.available ?? 4) - permHours).toFixed(2)}h would remain this month`}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Date row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[14px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">From *</label>
                  <input type="date" value={form.fromDate}
                    onChange={e => setForm({ ...form, fromDate: e.target.value, toDate: e.target.value })}
                    className="w-full border border-gray-200 rounded px-3 py-2.5 text-[13.5px] outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-blue-100 transition" />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">To *</label>
                  <input type="date" value={form.toDate} min={form.fromDate}
                    onChange={e => setForm({ ...form, toDate: e.target.value })}
                    className="w-full border border-gray-200 rounded px-3 py-2.5 text-[13.5px] outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-blue-100 transition" />
                </div>
              </div>

              {/* Working days auto-calc */}
              {workingDays > 0 && (
                <div className={`flex items-center gap-2 rounded px-3 py-2 border ${LEAVE_COLORS[form.leaveType] || 'bg-blue-50 border-blue-200'}`}>
                  <Calendar size={14} className="text-blue-500 flex-shrink-0" />
                  <p className="text-[14px] text-blue-700 font-semibold">
                    {workingDays} working day{workingDays !== 1 ? 's' : ''} selected
                    {form.fromDate !== form.toDate && ` (${fmtDate(form.fromDate)} – ${fmtDate(form.toDate)})`}
                  </p>
                </div>
              )}

              {/* Half day toggle */}
              <div className="flex items-center gap-3">
                <input type="checkbox" id="halfday" checked={form.isHalfDay}
                  onChange={e => setForm({ ...form, isHalfDay: e.target.checked })}
                  className="w-4 h-4 rounded accent-[#1a73e8]" />
                <label htmlFor="halfday" className="text-[15px] text-gray-700 font-medium cursor-pointer">Half Day</label>
                {form.isHalfDay && (
                  <select value={form.halfDayType} onChange={e => setForm({ ...form, halfDayType: e.target.value })}
                    className="ml-2 border border-gray-200 rounded px-2 py-1 text-[14px] outline-none focus:border-[#1a73e8]">
                    <option value="first_half">First Half</option>
                    <option value="second_half">Second Half</option>
                  </select>
                )}
              </div>
            </>
          )}

          {/* Reason */}
          <div>
            <label className="block text-[14px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Reason *</label>
            <textarea
              rows={3}
              value={form.reason}
              onChange={e => setForm({ ...form, reason: e.target.value })}
              placeholder="Please provide reason for leave..."
              className="w-full border border-gray-200 rounded px-3 py-2 text-[13.5px] text-gray-800 outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-blue-100 resize-none transition placeholder:text-gray-400"
            />
          </div>

          {/* Team Notification Email (optional) */}
          <div>
            <label className="block text-[14px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Notify Team (optional)</label>
            <input type="email" value={form.teamEmail}
              onChange={e => setForm({ ...form, teamEmail: e.target.value })}
              placeholder="team@company.com"
              className="w-full border border-gray-200 rounded px-3 py-2.5 text-[13.5px] outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-blue-100 transition placeholder:text-gray-400" />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-5 py-2 text-[15px] font-semibold text-gray-600 hover:bg-gray-50 rounded border border-gray-200 transition">
              Cancel
            </button>
            <button type="submit" disabled={loading || insufficientBalance}
              className="px-5 py-2 text-[15px] font-bold bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded transition disabled:opacity-50 flex items-center gap-2">
              {loading && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Apply Leave
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Reject Reason Modal ─────────────────────────────────────────────── */
function RejectModal({ leave, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-[16px] font-bold text-[#1a2040]">Reject Leave</h3>
          <button onClick={onClose}><X size={16} className="text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-[15px] text-gray-600">Add an optional comment for this rejection (not required).</p>
          <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Optional comment…"
            className="w-full border border-gray-200 rounded px-3 py-2 text-[15px] outline-none focus:border-red-300 resize-none" />
          <div className="flex items-center justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-[14px] font-semibold text-gray-600 hover:bg-gray-50 rounded border border-gray-200">Cancel</button>
            <button disabled={loading} onClick={async () => {
              setLoading(true);
              await onConfirm(reason);
              setLoading(false);
            }} className="px-4 py-2 text-[14px] font-bold bg-[#E53935] hover:bg-red-700 text-white rounded disabled:opacity-50 flex items-center gap-2">
              {loading && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Status Pill ─────────────────────────────────────────────────────── */
const STATUS_PILL = {
  approved:  'bg-green-100 text-green-700',
  pending:   'bg-amber-100 text-amber-700',
  rejected:  'bg-red-100 text-red-600',
  cancelled: 'bg-gray-100 text-gray-500',
};

/* ══════════════════════════════════════════════════════════════════════ */
export default function LeaveSummary() {
  const [cards, setCards]           = useState([]);
  const [leaves, setLeaves]         = useState([]);
  const [detailLeave, setDetailLeave] = useState(null);  // leave shown in the detail/timeline modal
  const [holidays, setHolidays]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showApply, setShowApply]   = useState(false);
  const [showReject, setShowReject] = useState(null); // leave object
  const [section, setSection]       = useState('upcoming'); // 'upcoming' | 'past'
  const [dateRange, setDateRange]   = useState(() => {
    const now = new Date();
    return {
      year: now.getFullYear(),
      label: `01/01/${now.getFullYear()} - 31/12/${now.getFullYear()}`,
    };
  });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/leaves/balance?year=${dateRange.year}`),
      api.get(`/leaves/my?year=${dateRange.year}`),
      api.get(`/attendance/holidays?year=${dateRange.year}`).catch(() => ({ data: { data: [] } })),
    ]).then(([b, l, h]) => {
      setCards(b.data.data || []);
      setLeaves(l.data.data || []);
      setHolidays(h.data.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [dateRange.year]);

  useEffect(() => { load(); }, [load]);

  const handleCancel = async (id) => {
    const { ok, reason, empty } = await confirmCancel('Cancel this leave request?');
    if (empty) return toast.error('A reason for cancelling is required');
    if (!ok) return;
    try { await api.delete(`/leaves/${id}`, { data: { reason } }); toast.success('Leave cancelled'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const today = new Date();
  const bookedTotal = leaves.filter(l => l.status === 'approved').reduce((s, l) => s + (l.totalDays || 0), 0);

  // Upcoming holidays (future dates)
  const upcomingHolidays = holidays.filter(h => new Date(h.date) >= today).slice(0, 10);
  // Past leaves
  const pastLeaves = leaves.filter(l => new Date(l.endDate || l.startDate) < today);

  const ICON_MAP = {
    casual: '☀️', comp_off: '⭐', unpaid: '📋', permission: '🔑',
    sick: '🏥', earned: '💼',
  };
  const ICON_BG = {
    casual: 'bg-sky-50', comp_off: 'bg-teal-50', unpaid: 'bg-orange-50',
    permission: 'bg-violet-50', sick: 'bg-rose-50', earned: 'bg-blue-50',
  };
  const CARD_ACCENT = {
    casual: 'border-l-4 border-l-sky-400', comp_off: 'border-l-4 border-l-teal-400',
    unpaid: 'border-l-4 border-l-orange-400', permission: 'border-l-4 border-l-violet-400',
    sick: 'border-l-4 border-l-rose-400', earned: 'border-l-4 border-l-blue-400',
  };
  const AVAIL_COLOR = {
    casual: 'text-sky-600', comp_off: 'text-teal-600', unpaid: 'text-orange-600',
    permission: 'text-violet-600', sick: 'text-rose-600', earned: 'text-blue-600',
  };

  return (
    <div className="flex flex-col h-full font-sans bg-[#f4f5f7]">
      {/* ── Sub-header ────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4 text-[15px] text-gray-500">
          <BackButton to="/leave-tracker" label="Leave Tracker" />
          <span className="font-semibold text-gray-700">Leave booked this year : <span className="text-[#1a73e8]">{bookedTotal} day(s)</span></span>
          <span className="text-gray-300">|</span>
          <span>Absent : <span className="font-semibold">—</span></span>
        </div>
        <div className="flex items-center gap-3">
          {/* Date range nav */}
          <div className="flex items-center gap-2 border border-gray-200 rounded px-2 py-1.5 text-[15px] text-gray-600">
            <button onClick={() => setDateRange(prev => ({ year: prev.year - 1, label: `01/01/${prev.year - 1} - 31/12/${prev.year - 1}` }))}
              className="hover:text-blue-600 transition-colors"><ChevronLeft size={14} /></button>
            <Calendar size={13} className="text-gray-400" />
            <button onClick={() => setDateRange(prev => ({ year: prev.year + 1, label: `01/01/${prev.year + 1} - 31/12/${prev.year + 1}` }))}
              className="hover:text-blue-600 transition-colors"><ChevronRight size={14} /></button>
            <span className="font-semibold text-gray-700 ml-1">{dateRange.label}</span>
          </div>
          {/* Apply button */}
          <button onClick={() => setShowApply(true)}
            className="flex items-center gap-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white text-[15px] font-bold px-4 py-2 rounded transition-colors shadow-sm">
            Apply Leave
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* ── Leave Type Cards ──────────────────────────────────────── */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
                <div className="w-10 h-10 bg-gray-100 rounded mb-3" />
                <div className="h-3 bg-gray-100 rounded w-24 mb-2" />
                <div className="h-5 bg-gray-100 rounded w-16" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {cards.filter(c => ['casual', 'comp_off', 'unpaid', 'permission'].includes(c.code)).map(card => {
              // Permission is hourly (4h/month); other leave types stay in days.
              const isPerm = card.code === 'permission';
              const unit = isPerm ? 'h' : '';
              // Round to 2 dp so JS float math doesn't show 2.9699999999999998.
              const fmt = (v) => (v === null || v === undefined) ? '—' : `${Math.round((v + Number.EPSILON) * 100) / 100}${unit}`;
              return (
                <div key={card.code} className={`bg-white rounded-lg border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow ${CARD_ACCENT[card.code] || ''}`}>
                  {/* Icon */}
                  <div className={`w-11 h-11 rounded flex items-center justify-center text-[22px] mb-4 ${ICON_BG[card.code] || 'bg-gray-50'}`}>
                    {ICON_MAP[card.code] || card.icon || '📋'}
                  </div>
                  {/* Name */}
                  <p className="text-[14px] font-bold text-gray-600 mb-3">{card.name}{isPerm && <span className="ml-1 text-[12px] font-medium text-gray-400">/ 4h month</span>}</p>
                  {/* Available */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[14px] text-gray-500">Available</span>
                    <span className={`text-[15px] font-bold ${AVAIL_COLOR[card.code] || 'text-[#34a853]'}`}>
                      {fmt(card.available)}
                    </span>
                  </div>
                  {/* Booked / Used this month */}
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] text-gray-500">{isPerm ? 'Used this month' : 'Booked'}</span>
                    <span className="flex items-center gap-1 text-[14px] font-semibold text-gray-700">
                      {fmt(card.booked)}
                      <button className="text-gray-300 hover:text-gray-500 transition-colors">
                        <Info size={11} />
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Upcoming Leaves & Holidays ────────────────────────────── */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setSection(s => s === 'upcoming' ? 'none' : 'upcoming')}
            className="w-full flex items-center justify-between px-5 py-3.5 border-b border-gray-100 hover:bg-gray-50 transition-colors"
          >
            <span className="text-[15px] font-bold text-gray-700">Upcoming Leaves &amp; Holidays</span>
            <ChevronDown size={15} className={`text-gray-400 transition-transform ${section === 'upcoming' ? 'rotate-180' : ''}`} />
          </button>
          {section === 'upcoming' && (
            <div className="divide-y divide-gray-50">
              {upcomingHolidays.length === 0 ? (
                <p className="px-5 py-8 text-center text-[15px] text-gray-400">No upcoming holidays</p>
              ) : upcomingHolidays.map((h, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                  <div className="text-[14px] font-semibold text-gray-600 w-[180px] flex-shrink-0">
                    {fmtDateLong(h.date)}
                  </div>
                  <div className="flex items-center gap-2 text-gray-500">
                    <Calendar size={13} className="text-gray-400" />
                    <span className="text-[14px] font-medium text-gray-700">{h.name}</span>
                  </div>
                  <span className="text-[14px] text-gray-500 ml-auto">{h.description || h.name + ' Holiday'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Past Leaves & Holidays ────────────────────────────────── */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setSection(s => s === 'past' ? 'none' : 'past')}
            className="w-full flex items-center justify-between px-5 py-3.5 border-b border-gray-100 hover:bg-gray-50 transition-colors"
          >
            <span className="text-[15px] font-bold text-gray-700">Past Leaves &amp; Holidays</span>
            <ChevronDown size={15} className={`text-gray-400 transition-transform ${section === 'past' ? 'rotate-180' : ''}`} />
          </button>
          {section === 'past' && (
            <div className="divide-y divide-gray-100">
              {pastLeaves.length === 0 ? (
                <p className="px-5 py-8 text-center text-[15px] text-gray-400">No past leaves</p>
              ) : pastLeaves.map(l => (
                <div key={l._id} className="px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[15px] font-semibold text-gray-800">
                            {{ casual: 'Casual Leave', comp_off: 'Compensatory Off', unpaid: 'Leave Without Pay', permission: 'Permission' }[l.leaveType] || l.leaveType}
                          </span>
                          <span className={`text-[13px] font-bold px-2 py-0.5 rounded-full capitalize ${STATUS_PILL[l.status] || 'bg-gray-100 text-gray-500'}`}>
                            {l.status}
                          </span>
                        </div>
                        <p className="text-[14px] text-gray-500 mt-0.5">
                          {fmtDate(l.startDate)} · {l.totalDays} day{l.totalDays !== 1 ? 's' : ''}
                        </p>
                        {l.rejectionReason && (
                          <p className="text-[13px] text-red-500 mt-1">Reason: {l.rejectionReason}</p>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setDetailLeave(l)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-[14px] font-semibold transition-colors flex-shrink-0">
                      <Eye size={13} /> View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {detailLeave && (
        <LeaveDetailModal
          leave={detailLeave}
          balance={cards}
          onClose={() => setDetailLeave(null)}
          onCancel={(x) => { setDetailLeave(null); handleCancel(x._id); }}
        />
      )}

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {showApply && (
        <ApplyLeaveModal
          cards={cards.filter(c => ['casual', 'comp_off', 'unpaid', 'permission'].includes(c.code))}
          holidays={holidays}
          onClose={() => setShowApply(false)}
          onSubmitted={load}
        />
      )}
      {showReject && (
        <RejectModal
          leave={showReject}
          onClose={() => setShowReject(null)}
          onConfirm={async reason => {
            try {
              await api.put(`/leaves/${showReject._id}/action`, { action: 'rejected', rejectionReason: reason });
              toast.success('Leave rejected');
              setShowReject(null);
              load();
            } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
          }}
        />
      )}
    </div>
  );
}
