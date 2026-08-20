import React, { useEffect, useState } from 'react';
import { X, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

// Correcting somebody else's attendance entry.
//
// Carries its own date picker rather than editing only the day it was opened
// from: the reason to reach for this is almost always a day that has already
// gone wrong, not today.
//
// Two things are said out loud on the form rather than buried in a policy. The
// person will be told their record changed — an edit they cannot see is what
// this feature could most easily become. And a reason is asked for, because
// "why is my Tuesday different" is the question that follows.

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function EditAttendanceEntry({ employee, date: initialDate, onClose, onSaved }) {
  const [date, setDate] = useState(initialDate || todayStr());
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/attendance-entry/${employee._id}/${date}`)
      .then(r => {
        if (cancelled) return;
        const e = r.data.data?.entry;
        setCurrent(e || null);
        setCheckIn(e?.checkIn || '');
        setCheckOut(e?.checkOut || '');
      })
      .catch(() => { if (!cancelled) { setCurrent(null); setCheckIn(''); setCheckOut(''); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employee._id, date]);

  const save = async () => {
    if (checkIn && checkOut && checkOut <= checkIn) {
      toast.error('Check-out must be after check-in');
      return;
    }
    setSaving(true);
    try {
      const r = await api.put(`/attendance-entry/${employee._id}/${date}`, {
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        reason: reason.trim() || null,
      });
      toast.success(r.data.message || 'Saved');
      onSaved?.(r.data.data);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not save the entry');
    } finally { setSaving(false); }
  };

  const fieldClass = 'text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl w-full max-w-[440px] shadow-xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">Edit attendance entry</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-[14px] font-medium text-slate-800">
              {employee.employeeId && <span className="text-slate-500 font-normal">{employee.employeeId} &middot; </span>}
              {employee.firstName} {employee.lastName}
            </p>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Date</label>
            <input type="date" value={date} max={todayStr()}
              onChange={e => setDate(e.target.value)} className={fieldClass} />
          </div>

          <div className="flex gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Check-in</label>
              <input type="time" value={checkIn} onChange={e => setCheckIn(e.target.value)}
                disabled={loading} className={fieldClass} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Check-out</label>
              <input type="time" value={checkOut} onChange={e => setCheckOut(e.target.value)}
                disabled={loading} className={fieldClass} />
            </div>
          </div>

          {!loading && (
            <p className="text-[12.5px] text-slate-500">
              {current
                ? `Currently ${current.checkIn || '—'}${current.checkOut ? ` to ${current.checkOut}` : ''}`
                  + `, recorded as ${current.status}.`
                : 'Nothing is recorded for this day yet.'}
            </p>
          )}

          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
              Reason <span className="font-normal text-slate-400">(kept with the record)</span>
            </label>
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Biometric did not register" className={`${fieldClass} w-full`} />
          </div>

          <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {employee.firstName} will be notified that their entry was changed, and the change is
            kept in the change history with your name on it.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200">
          <button onClick={onClose}
            className="border border-slate-200 hover:bg-slate-50 px-4 py-1.5 rounded-md text-[13.5px] text-slate-600">
            Cancel
          </button>
          <button onClick={save} disabled={saving || loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-1.5 rounded-md text-[13.5px] font-semibold">
            {saving ? 'Saving…' : 'Save entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

// The affordance that opens it. Renders nothing at all unless the setting is on
// and the viewer is allowed to edit, so the button never appears where pressing
// it would 403.
export function EditEntryButton({ employee, date, onSaved, className = '' }) {
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/attendance-config/checkin')
      .then(r => { if (!cancelled) setAllowed(r.data.data?.allowEditReporteeEntries === true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!allowed) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Edit this attendance entry"
        aria-label={`Edit attendance for ${employee.firstName} ${employee.lastName}`}
        className={`text-slate-300 hover:text-blue-600 transition-colors flex-shrink-0 ${className}`}
      >
        <Pencil size={14} />
      </button>
      {open && (
        <EditAttendanceEntry
          employee={employee} date={date}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
