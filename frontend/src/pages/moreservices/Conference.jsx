import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Calendar, DoorOpen, Eye, Pencil, X, AlertTriangle } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';

/* ── Operations → Conference ──────────────────────────────────────────────
 *  Book a conference hall (Floor 1 / Floor 2) for a date + time window.
 *  Overlap is prevented per hall server-side; different halls can share a
 *  time. All data is dynamic (GET/POST/PUT /api/conference).
 *
 *  Access: super_admin, hr, manager (Team Lead) only. */

const HALLS = ['Floor 1', 'Floor 2'];
const ALLOWED_ROLES = ['admin', 'director', 'hr_admin', 'manager'];
const todayStr = () => new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD (local)
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const EMPTY = { title: '', bookingDate: todayStr(), startTime: '', endTime: '', hall: 'Floor 1', description: '', bookedFor: '' };

/* ── 12-hour time helpers ─────────────────────────────────────────────────
 *  The API still uses 24-hour "HH:MM" strings (conflict detection unchanged);
 *  these only convert to/from the user-facing 12-hour AM/PM view. */
const HHMM = /^\d{2}:\d{2}$/;
const to12 = (hhmm) => {
  if (!hhmm || !HHMM.test(hhmm)) return { h: '', m: '', mer: 'AM' };
  const [H, M] = hhmm.split(':').map(Number);
  const mer = H >= 12 ? 'PM' : 'AM';
  let h = H % 12; if (h === 0) h = 12;
  return { h: String(h), m: String(M).padStart(2, '0'), mer };
};
const from12 = (h, m, mer) => {
  if (!h) return '';
  let H = parseInt(h, 10) % 12;
  if (mer === 'PM') H += 12;
  const mm = String(m === '' || m == null ? 0 : m).padStart(2, '0');
  return `${String(H).padStart(2, '0')}:${mm}`;
};
const fmt12 = (hhmm) => {
  if (!hhmm || !HHMM.test(hhmm)) return '—';
  const { h, m, mer } = to12(hhmm);
  return `${h}:${m} ${mer}`;
};

/* ── Dynamic status ───────────────────────────────────────────────────────
 *  DB stores 'booked' | 'cancelled'. Display status is derived live from
 *  the booking date/time vs the user's current clock.
 *    Booked      — start hasn't arrived yet
 *    In Progress — start ≤ now < end (on the booking day)
 *    Completed   — end has passed
 *    Cancelled   — explicitly cancelled by the booker */
const STATUS_PILL = {
  booked:      { label: 'Booked',      cls: 'bg-emerald-50 text-emerald-700' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700' },
  completed:   { label: 'Completed',   cls: 'bg-slate-100 text-slate-500' },
  cancelled:   { label: 'Cancelled',   cls: 'bg-rose-50 text-rose-700' },
};

const pad2 = n => String(n).padStart(2, '0');

const computeStatus = (b) => {
  if (b.status === 'cancelled') return 'cancelled';

  // Use local date/time components — avoids locale and timezone string bugs.
  const now  = new Date();
  const nowDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const nowTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  // bookingDate may arrive as "YYYY-MM-DD" or as an ISO timestamp (UTC from DB server).
  // Always derive the local calendar date to avoid off-by-one in IST / any UTC+ zone.
  let bd = '';
  if (b.bookingDate) {
    const s = String(b.bookingDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      bd = s; // plain date string — use as-is
    } else {
      const d = new Date(s);
      if (!isNaN(d)) bd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
  }

  if (!bd) return b.status || 'booked';
  if (bd > nowDate) return 'booked';
  if (bd < nowDate) return 'completed';

  // Same calendar day — compare HH:MM (slice to 5 in case DB returns HH:MM:SS).
  const start = String(b.startTime || '00:00').slice(0, 5);
  const end   = String(b.endTime   || '23:59').slice(0, 5);
  if (nowTime < start) return 'booked';
  if (nowTime < end)   return 'in_progress';
  return 'completed';
};

// 12-hour time selector (hour 1–12 · minute · AM/PM) that emits a 24h "HH:MM".
function TimeSelect12({ value, onChange }) {
  const { h, m, mer } = to12(value);
  const cls = 'border border-slate-200 rounded-lg px-2 py-2.5 text-[13.5px] bg-white focus:outline-none focus:border-blue-400';
  return (
    <div className="flex items-center gap-1.5">
      <select value={h} onChange={e => {
        const newH = e.target.value;
        // Hour 12 with AM = midnight — auto-flip to PM so users get 12:xx PM (noon) as expected.
        const newMer = (newH === '12' && mer === 'AM') ? 'PM' : mer;
        onChange(from12(newH, m, newMer));
      }} className={cls}>
        <option value="">HH</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{String(n).padStart(2, '0')}</option>)}
      </select>
      <span className="text-slate-400 font-semibold">:</span>
      <select value={m} onChange={e => onChange(from12(h, e.target.value, mer))} className={cls}>
        {h === '' && <option value="">MM</option>}
        {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(mm => <option key={mm} value={mm}>{mm}</option>)}
      </select>
      <select value={mer} onChange={e => onChange(from12(h, m, e.target.value))} className={cls}>
        <option>AM</option>
        <option>PM</option>
      </select>
    </div>
  );
}

/* onCancel is passed only in edit mode — triggers "Cancel Meeting" button on the left footer. */
function BookingModal({ initial, onClose, onSaved, onCancel }) {
  const { user } = useAuth();
  const editing = !!initial?._id;
  const bookingBy = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
    || (editing ? (initial.bookedBy || '') : '');
  const buildForm = (src) => src ? {
    title: src.title || '', bookingDate: src.bookingDate ? src.bookingDate.slice(0, 10) : todayStr(),
    startTime: src.startTime || '', endTime: src.endTime || '',
    hall: src.hall || 'Floor 1', description: src.description || '', bookedFor: src.bookedFor || '',
  } : { ...EMPTY };
  const [form, setForm] = useState(buildForm(initial));
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState(initial?.bookedFor ? 'others' : 'me');
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const clearForm = () => { setForm({ ...EMPTY }); setError(''); };
  const chooseMode = (m) => { setMode(m); if (m === 'me') set('bookedFor', ''); };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'others' && !form.bookedFor.trim()) return setError('Please enter the name you are booking for.');
    if (!form.title.trim()) return setError('Meeting purpose is required.');
    if (!form.bookingDate) return setError('Scheduled date is required.');
    if (!form.startTime || !form.endTime) return setError('Start and end time are required.');
    if (form.endTime <= form.startTime) return setError('End time must be after the start time.');
    const now = new Date();
    if (form.bookingDate < todayStr()) return setError('You cannot book a past date.');
    if (form.bookingDate === todayStr()) {
      const nowHM = now.toTimeString().slice(0, 5);
      if (form.startTime < nowHM) return setError('You cannot book a time that has already passed.');
    }
    const payload = { ...form, bookedFor: mode === 'others' ? form.bookedFor.trim() : '' };
    setSaving(true);
    try {
      if (editing) await api.put(`/conference/${initial._id}`, payload);
      else await api.post('/conference', payload);
      toast.success(editing ? 'Booking updated' : 'Conference hall booked');
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save booking');
    } finally { setSaving(false); }
  };

  const label = 'block text-[14px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-[17px] font-bold text-slate-800">{editing ? 'Edit Booking' : 'Book Conference Hall'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {error && (
          <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[14px] text-rose-700">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <form onSubmit={submit} className="p-6 space-y-4">
          {/* Booking type — two separate card buttons with visible gap */}
          <div>
            <label className={label}>Booking Type</label>
            <div className="flex gap-3">
              {[['me', 'Book for Me'], ['others', 'Book for Others']].map(([m, txt]) => (
                <button key={m} type="button" onClick={() => chooseMode(m)}
                  className={`flex-1 px-4 py-2.5 rounded-xl border-2 text-[15px] font-semibold transition-all ${
                    mode === m
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  }`}>
                  {txt}
                </button>
              ))}
            </div>
          </div>
          {mode === 'me' ? (
            <div>
              <label className={label}>Booking By</label>
              <input value={bookingBy || '—'} readOnly
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13.5px] bg-slate-50 text-slate-600 cursor-not-allowed focus:outline-none" />
            </div>
          ) : (
            <div>
              <label className={label}>Booking For *</label>
              <input value={form.bookedFor} onChange={e => set('bookedFor', e.target.value)} placeholder="Employee name"
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13.5px] focus:outline-none focus:border-blue-400" />
            </div>
          )}
          <div>
            <label className={label}>Meeting Purpose *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Sprint planning"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13.5px] focus:outline-none focus:border-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Scheduled Date *</label>
              <input type="date" min={todayStr()} value={form.bookingDate} onChange={e => set('bookingDate', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13.5px] focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className={label}>Conference Hall *</label>
              <select value={form.hall} onChange={e => set('hall', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13.5px] bg-white focus:outline-none focus:border-blue-400">
                {HALLS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Start Time *</label>
              <TimeSelect12 value={form.startTime} onChange={v => set('startTime', v)} />
            </div>
            <div>
              <label className={label}>End Time *</label>
              <TimeSelect12 value={form.endTime} onChange={v => set('endTime', v)} />
            </div>
          </div>
          <div>
            <label className={label}>Additional Info (optional)</label>
            <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] focus:outline-none focus:border-blue-400 resize-none" />
          </div>
          {/* Footer: Cancel Meeting (left, edit only) | Clear · Update/Book (right) */}
          <div className="flex items-center justify-between pt-1">
            <div>
              {editing && onCancel && (
                <button type="button" onClick={onCancel}
                  className="border border-rose-200 text-rose-600 hover:bg-rose-50 px-4 py-2 rounded-lg text-[15px] font-medium">
                  Cancel Meeting
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={clearForm} className="border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[15px] font-medium">Clear</button>
              {!editing && (
                <button type="button" onClick={onClose} className="border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[15px] font-medium">Cancel</button>
              )}
              <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-[15px] font-semibold disabled:opacity-60">
                {saving ? 'Saving…' : (editing ? 'Update' : 'Book')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ViewModal({ booking, onClose }) {
  const Row = ({ label, children }) => (
    <div className="flex items-start gap-3 py-2 border-b border-slate-50 last:border-0">
      <span className="text-[13px] font-semibold uppercase tracking-wide text-slate-400 w-32 flex-shrink-0">{label}</span>
      <span className="text-[15px] text-slate-700">{children}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-[17px] font-bold text-slate-800">Booking Details</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-6">
          <Row label="Booking Details">
            By {booking.bookedBy || '—'}
            {booking.bookedFor && <span className="text-slate-500"> For {booking.bookedFor}</span>}
          </Row>
          <Row label="Meeting Purpose">{booking.title}</Row>
          <Row label="Date">{fmtDate(booking.bookingDate)}</Row>
          <Row label="Time">{fmt12(booking.startTime)} – {fmt12(booking.endTime)}</Row>
          <Row label="Hall">{booking.hall}</Row>
          {booking.description && <Row label="Additional Info">{booking.description}</Row>}
        </div>
      </div>
    </div>
  );
}

export default function Conference() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Role guard — employees have no access to Conference.
  useEffect(() => {
    if (user && !ALLOWED_ROLES.includes(user.role)) {
      navigate('/more-services/operations', { replace: true });
    }
  }, [user, navigate]);

  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [, setTick] = useState(0);
  // Re-render every 60 s so computeStatus reflects the current time automatically.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/conference?date=${date}`)
      .then(r => setRows(r.data.data || []))
      .catch(() => toast.error('Failed to load bookings'))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const cancelBooking = async (id) => {
    if (!confirm('Cancel this meeting? The slot will be freed and the record will remain in history.')) return;
    try {
      await api.delete(`/conference/${id}`);
      toast.success('Meeting cancelled');
      setModal(null);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to cancel'); }
  };

  if (user && !ALLOWED_ROLES.includes(user.role)) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/more-services/operations')} className="text-slate-400 hover:text-slate-700"><ArrowLeft size={18} /></button>
          <div className="flex items-center gap-2">
            <DoorOpen size={18} className="text-blue-600" />
            <div>
              <h2 className="text-[17px] font-bold text-slate-800">Conference</h2>
              <p className="text-[14px] text-slate-400">Book conference halls and manage meeting schedules</p>
            </div>
          </div>
        </div>
        <button onClick={() => setModal({ bookingDate: date })} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[15px] font-semibold">
          <Plus size={15} /> Book Conference Hall
        </button>
      </div>

      {/* Date filter */}
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
        <Calendar size={14} className="text-slate-400" />
        <span className="text-[14px] text-slate-500 font-medium">Schedule for</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] bg-white focus:outline-none focus:border-blue-400" />
        {date !== todayStr() && (
          <button onClick={() => setDate(todayStr())} className="text-[14px] text-blue-600 hover:text-blue-700 font-medium">Today</button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-[13px] font-semibold text-slate-500 uppercase tracking-wider">
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Start</th>
              <th className="px-5 py-3">End</th>
              <th className="px-5 py-3">Booking Details</th>
              <th className="px-5 py-3">Conference Hall</th>
              <th className="px-5 py-3">Meeting Purpose</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={8} className="px-5 py-16 text-center"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-16 text-center">
                <Calendar size={32} className="text-slate-200 mx-auto mb-3"/>
                <p className="text-[15px] font-semibold text-slate-400">No bookings for {fmtDate(date)}</p>
                <p className="text-[14px] text-slate-300 mt-1">Click "Book Conference Hall" to schedule one</p>
              </td></tr>
            ) : rows.map(b => {
              const dynStatus = computeStatus(b);
              const pill = STATUS_PILL[dynStatus] || STATUS_PILL.booked;
              return (
                <tr key={b._id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3.5 text-[14px] text-slate-600">{fmtDate(b.bookingDate)}</td>
                  <td className="px-5 py-3.5 text-[15px] text-slate-600">{fmt12(b.startTime)}</td>
                  <td className="px-5 py-3.5 text-[15px] text-slate-600">{fmt12(b.endTime)}</td>
                  <td className="px-5 py-3.5 text-[14px] text-slate-700 max-w-[200px] truncate" title={`By ${b.bookedBy || '—'}${b.bookedFor ? ` For ${b.bookedFor}` : ''}`}>
                    By {b.bookedBy || '—'}
                    {b.bookedFor && <span className="text-slate-500"> For {b.bookedFor}</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{b.hall}</span>
                  </td>
                  <td className="px-5 py-3.5 text-[15px] text-slate-700 max-w-[200px] truncate" title={b.title}>{b.title}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center text-[13px] font-semibold px-2.5 py-0.5 rounded-full ${pill.cls}`}>
                      {pill.label}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setViewing(b)} title="View" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><Eye size={15} /></button>
                    <button onClick={() => setModal(b)} title="Edit" className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"><Pencil size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <BookingModal
          initial={modal._id ? modal : { bookingDate: modal.bookingDate || date }}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          onCancel={modal._id ? () => cancelBooking(modal._id) : undefined}
        />
      )}
      {viewing && <ViewModal booking={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
