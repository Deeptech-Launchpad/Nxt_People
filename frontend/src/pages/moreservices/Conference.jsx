import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Calendar, Clock, DoorOpen, Eye, Pencil, Trash2, X } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ── Operations → Conference ──────────────────────────────────────────────
 *  Book a conference hall (Floor 1 / Floor 2) for a date + time window.
 *  Overlap is prevented per hall server-side; different halls can share a
 *  time. All data is dynamic (GET/POST/PUT/DELETE /api/conference). */

const HALLS = ['Floor 1', 'Floor 2'];
const todayStr = () => new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD (local)
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const EMPTY = { title: '', bookingDate: todayStr(), startTime: '', endTime: '', hall: 'Floor 1', description: '' };

function BookingModal({ initial, onClose, onSaved }) {
  const editing = !!initial?._id;
  const [form, setForm] = useState(initial ? {
    title: initial.title || '', bookingDate: initial.bookingDate ? initial.bookingDate.slice(0, 10) : todayStr(),
    startTime: initial.startTime || '', endTime: initial.endTime || '',
    hall: initial.hall || 'Floor 1', description: initial.description || '',
  } : EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Conducted By (organizer name) is required');
    if (!form.bookingDate) return toast.error('Booking date is required');
    if (!form.startTime || !form.endTime) return toast.error('Start and end time are required');
    if (form.endTime <= form.startTime) return toast.error('End time must be after start time');
    // Block past date / past time (current day) at the UI before hitting the API.
    const now = new Date();
    if (form.bookingDate < todayStr()) return toast.error('You cannot book a past date');
    if (form.bookingDate === todayStr()) {
      const nowHM = now.toTimeString().slice(0, 5);
      if (form.startTime < nowHM) return toast.error('You cannot book a time that has already passed');
    }
    setSaving(true);
    try {
      if (editing) await api.put(`/conference/${initial._id}`, form);
      else await api.post('/conference', form);
      toast.success(editing ? 'Booking updated' : 'Conference hall booked');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save booking');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-[15px] font-bold text-slate-800">{editing ? 'Edit Booking' : 'Book Conference Hall'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-[12px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Conducted By *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Sarah"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13.5px] focus:outline-none focus:border-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Booking Date *</label>
              <input type="date" min={todayStr()} value={form.bookingDate} onChange={e => set('bookingDate', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13.5px] focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Conference Hall *</label>
              <select value={form.hall} onChange={e => set('hall', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13.5px] bg-white focus:outline-none focus:border-blue-400">
                {HALLS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Start Time *</label>
              <input type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13.5px] focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">End Time *</label>
              <input type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13.5px] focus:outline-none focus:border-blue-400" />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Description (optional)</label>
            <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] focus:outline-none focus:border-blue-400 resize-none" />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[13px] font-medium">Cancel</button>
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-60">
              {saving ? 'Saving…' : (editing ? 'Update' : 'Book Hall')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ViewModal({ booking, onClose }) {
  const Row = ({ label, children }) => (
    <div className="flex items-start gap-3 py-2 border-b border-slate-50 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-28 flex-shrink-0">{label}</span>
      <span className="text-[13px] text-slate-700">{children}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-[15px] font-bold text-slate-800">Booking Details</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-6">
          <Row label="Conducted By">{booking.title}</Row>
          <Row label="Date">{fmtDate(booking.bookingDate)}</Row>
          <Row label="Time">{booking.startTime} – {booking.endTime}</Row>
          <Row label="Hall">{booking.hall}</Row>
          <Row label="Booked By">{booking.bookedBy || '—'}{booking.bookedByEmpId ? ` (${booking.bookedByEmpId})` : ''}</Row>
          <Row label="Description">{booking.description || '—'}</Row>
        </div>
      </div>
    </div>
  );
}

export default function Conference() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);   // null | {} (new) | booking (edit)
  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/conference?date=${date}`)
      .then(r => setRows(r.data.data || []))
      .catch(() => toast.error('Failed to load bookings'))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const cancelBooking = async (id) => {
    if (!confirm('Cancel this booking? The slot will be freed immediately.')) return;
    try {
      await api.delete(`/conference/${id}`);
      toast.success('Booking cancelled');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to cancel'); }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/more-services/operations')} className="text-slate-400 hover:text-slate-700"><ArrowLeft size={18} /></button>
          <div className="flex items-center gap-2">
            <DoorOpen size={18} className="text-blue-600" />
            <div>
              <h2 className="text-[15px] font-bold text-slate-800">Conference</h2>
              <p className="text-[12px] text-slate-400">Book conference halls and manage meeting schedules</p>
            </div>
          </div>
        </div>
        <button onClick={() => setModal({})} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[13px] font-semibold">
          <Plus size={15} /> Book Conference Hall
        </button>
      </div>

      {/* Date filter */}
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
        <Calendar size={14} className="text-slate-400" />
        <span className="text-[12px] text-slate-500 font-medium">Schedule for</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] bg-white focus:outline-none focus:border-blue-400" />
        {date !== todayStr() && (
          <button onClick={() => setDate(todayStr())} className="text-[12px] text-blue-600 hover:text-blue-700 font-medium">Today</button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Conference Hall</th>
              <th className="px-5 py-3">Conducted By</th>
              <th className="px-5 py-3">Booked By</th>
              <th className="px-5 py-3">Start</th>
              <th className="px-5 py-3">End</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={8} className="px-5 py-16 text-center"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-16 text-center text-slate-400 text-[13px]">No bookings for {fmtDate(date)}</td></tr>
            ) : rows.map(b => (
              <tr key={b._id} className="hover:bg-slate-50/70">
                <td className="px-5 py-3.5 text-[12.5px] text-slate-600">{fmtDate(b.bookingDate)}</td>
                <td className="px-5 py-3.5">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{b.hall}</span>
                </td>
                <td className="px-5 py-3.5 text-[13px] text-slate-700">{b.title}</td>
                <td className="px-5 py-3.5 text-[12.5px] text-slate-600">{b.bookedBy || '—'}</td>
                <td className="px-5 py-3.5 text-[13px] text-slate-600">{b.startTime}</td>
                <td className="px-5 py-3.5 text-[13px] text-slate-600">{b.endTime}</td>
                <td className="px-5 py-3.5"><span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Booked</span></td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => setViewing(b)} title="View" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><Eye size={15} /></button>
                    <button onClick={() => setModal(b)} title="Edit" className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"><Pencil size={15} /></button>
                    <button onClick={() => cancelBooking(b._id)} title="Cancel" className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && <BookingModal initial={modal._id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {viewing && <ViewModal booking={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
