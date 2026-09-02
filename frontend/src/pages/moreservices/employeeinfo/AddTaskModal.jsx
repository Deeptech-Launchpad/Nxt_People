import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import api from '../../../utils/api';

/* Add New Task, from the employee row menu.
 *
 * Reuses the existing tasks module rather than adding a second one — the row
 * menu just pre-assigns the employee it was opened on. `start_date` and
 * `reminder_at` were added to the table for this form.
 */
const input = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
const label = 'block text-[14px] font-medium text-slate-600 mb-1.5';
const today = () => new Date().toLocaleDateString('en-CA');

export default function AddTaskModal({ employee, onClose }) {
  const [form, setForm] = useState({
    title: '', description: '',
    startDate: today(), dueDate: today(), reminderAt: '',
    priority: 'medium', status: 'open',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (andNew) => {
    if (!form.title.trim()) return toast.error('Task name is required');
    setSaving(true);
    try {
      await api.post('/tasks', {
        title: form.title.trim(),
        description: form.description.trim() || null,
        assigneeId: employee._id,
        assignedTo: employee._id,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        reminderAt: form.reminderAt || null,
        priority: form.priority,
        status: form.status,
      });
      toast.success(`Task assigned to ${employee.firstName}`);
      if (andNew) setForm(f => ({ ...f, title: '', description: '' }));
      else onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not create that task');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-xl">Add Task</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-4">Task Details</p>
          <div className="space-y-4">
            <div>
              <label className={label}>Task owner</label>
              <input className={`${input} bg-slate-50 text-slate-500`} readOnly
                value={`${employee.employeeId || ''} ${employee.firstName || ''} ${employee.lastName || ''}`.trim()} />
            </div>
            <div>
              <label className={label}>Task name <span className="text-rose-500">*</span></label>
              <input className={input} value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Description</label>
              <textarea className={`${input} h-24 resize-none`} value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Start Date</label>
                <input type="date" className={input} value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div>
                <label className={label}>Due Date</label>
                <input type="date" className={input} value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className={label}>Reminder</label>
              <input type="datetime-local" className={input} value={form.reminderAt}
                onChange={e => setForm(f => ({ ...f, reminderAt: e.target.value }))} />
              {/* Storing a reminder is not the same as delivering one, and a
                  field that looks like it will notify somebody but does not is
                  worse than no field. */}
              <p className="text-[13px] text-slate-400 mt-1">
                Saved with the task. Reminder delivery is not built yet.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Priority</label>
                <select className={input} value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                  <option value="low">Low</option>
                  <option value="medium">Moderate</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label className={label}>Status <span className="text-rose-500">*</span></label>
                <select className={input} value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={() => submit(false)} disabled={saving}
            className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
            {saving ? 'Saving…' : 'Submit'}
          </button>
          <button onClick={() => submit(true)} disabled={saving}
            className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
            Submit and New
          </button>
          <button onClick={onClose}
            className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl text-[15px] hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
