import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Calendar, Plus, Trash2, X, Users } from 'lucide-react';
import api from '../../../utils/api';
import useEmployeeList from '../leavetracker/useEmployeeList';
import EmployeePicker from '../leavetracker/EmployeePicker';
import { ymd } from './shiftGrid';

/* ── Operations → Shift → Shift Group ─────────────────────────────────────
 *  A named bucket of people with an effective period. The reference uses it
 *  to narrow the schedule and to assign a shift to a whole group at once.
 *
 *  Membership carries dates, so the same person on one group in October and
 *  another in November is two rows rather than one that forgets October —
 *  which is why this screen is scoped to a month and says so, rather than
 *  showing a flat "who is in this group" list that would be true only today.
 *
 *  The group itself schedules nothing. Nothing here writes shift_roster;
 *  assigning a shift to these people is Employee Shift Mapping's Assign shift,
 *  and keeping that in one place is deliberate.
 * ────────────────────────────────────────────────────────────────────────── */

const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

export default function OpsShiftGroups() {
  const { people, loading: peopleLoading } = useEmployeeList();
  const [anchor, setAnchor] = useState(() => new Date());
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const period = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { from: ymd(first), to: ymd(last) };
  }, [anchor]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/shift-groups?on=${period.from}`),
      api.get(`/shift-groups/members?startDate=${period.from}&endDate=${period.to}`),
    ])
      .then(([g, m]) => { setGroups(g.data.data || []); setMembers(m.data.data || []); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load shift groups'))
      .finally(() => setLoading(false));
  }, [period.from, period.to]);

  useEffect(load, [load]);

  const byGroup = useMemo(() => {
    const map = new Map();
    for (const m of members) {
      if (!map.has(m.groupId)) map.set(m.groupId, []);
      map.get(m.groupId).push(m);
    }
    return map;
  }, [members]);

  const removeMember = async (id) => {
    try {
      await api.delete(`/shift-groups/members/${id}`);
      toast.success('Removed from the group');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Could not remove that mapping'); }
  };

  const deleteGroup = async (g) => {
    if (!window.confirm(`Delete the group "${g.name}"? Everyone mapped to it is unmapped. No schedule changes.`)) return;
    try {
      await api.delete(`/shift-groups/${g._id}`);
      toast.success('Group deleted');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Could not delete that group'); }
  };

  const step = (dir) => setAnchor(a => new Date(a.getFullYear(), a.getMonth() + dir, 1));

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ChevronLeft size={16} /></button>
          <Calendar size={15} className="text-slate-400" />
          <button onClick={() => step(1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ChevronRight size={16} /></button>
          <span className="text-[14px] font-semibold text-slate-800 ml-1">
            {anchor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          </span>
          {loading && <span className="text-[12px] text-slate-400 ml-2">loading…</span>}
        </div>
        <button onClick={() => setAssigning(true)}
          className="ml-auto bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-md text-[13px] font-semibold">
          Assign Shift Groups
        </button>
      </div>

      {members.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <Users size={28} className="mx-auto text-slate-300 mb-3" />
          <p className="text-[15px] font-medium text-slate-700">No employees have been mapped to a shift group</p>
          <p className="text-[13px] text-slate-500 mt-1 max-w-[460px] mx-auto">
            Assign employees to shift groups to group or to filter the employees while scheduling shift.
          </p>
          {groups.length > 0 && (
            <p className="text-[12px] text-slate-400 mt-3">
              {groups.length} group(s) exist but nobody is mapped to them this month.
            </p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {groups.filter(g => byGroup.has(g._id)).map(g => (
            <div key={g._id} className="px-5 py-4">
              <div className="flex items-center gap-3 mb-3">
                <h4 className="text-[15px] font-semibold text-slate-800">{g.name}</h4>
                <span className="text-[12px] text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                  {byGroup.get(g._id).length} this month
                </span>
                {g.description && <span className="text-[13px] text-slate-500">{g.description}</span>}
                <button onClick={() => deleteGroup(g)}
                  className="ml-auto text-slate-400 hover:text-red-500 p-1.5 rounded" title="Delete group">
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-y border-slate-200">
                      <th className="text-left px-4 py-2 text-[12px] font-medium text-slate-500">Employee</th>
                      <th className="text-left px-4 py-2 text-[12px] font-medium text-slate-500">Department</th>
                      <th className="text-left px-4 py-2 text-[12px] font-medium text-slate-500">Effective period</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {byGroup.get(g._id).map(m => (
                      <tr key={m._id} className="border-b border-slate-100">
                        <td className="px-4 py-2.5">
                          <span className="text-[13px] text-slate-500">{m.employeeCode}</span>{' '}
                          <span className="text-[14px] text-slate-800 font-medium">{m.employeeName}</span>
                        </td>
                        <td className="px-4 py-2.5 text-[13px] text-slate-600">{m.department || '—'}</td>
                        <td className="px-4 py-2.5 text-[13px] text-slate-600">
                          {new Date(`${m.effectiveFrom}T00:00:00`).toLocaleDateString('en-GB')}
                          {' — '}
                          {m.effectiveTo
                            ? new Date(`${m.effectiveTo}T00:00:00`).toLocaleDateString('en-GB')
                            : <span className="text-slate-400">open-ended</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => removeMember(m._id)}
                            className="text-slate-400 hover:text-red-500 p-1.5 rounded"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {assigning && (
        <AssignGroupPanel groups={groups} people={people} peopleLoading={peopleLoading}
          defaultFrom={period.from} defaultTo={period.to}
          onClose={() => setAssigning(false)} onSaved={load} />
      )}
    </div>
  );
}

function AssignGroupPanel({ groups, people, peopleLoading, defaultFrom, defaultTo, onClose, onSaved }) {
  const [groupId, setGroupId] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [employeeIds, setEmployeeIds] = useState([]);
  const [pick, setPick] = useState('');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [saving, setSaving] = useState(false);

  const createGroup = async () => {
    const name = newName.trim();
    if (!name) return toast.error('Give the group a name');
    try {
      const r = await api.post('/shift-groups', { name });
      toast.success(`"${name}" created`);
      setGroupId(r.data.data._id);
      setAdding(false); setNewName('');
      onSaved?.();
    } catch (err) { toast.error(err.response?.data?.message || 'Could not create that group'); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!groupId) return toast.error('Choose a shift group');
    if (!employeeIds.length) return toast.error('Choose at least one employee');
    if (!from) return toast.error('An effective period needs a start date');
    setSaving(true);
    try {
      const r = await api.post(`/shift-groups/${groupId}/members`, {
        employeeIds, effectiveFrom: from, effectiveTo: to || null,
      });
      toast.success(r.data.message || 'Mapped');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not map those employees');
    } finally { setSaving(false); }
  };

  const chosen = people.filter(p => employeeIds.includes(String(p._id)));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={onClose}>
      <form onSubmit={submit} className="bg-white w-full max-w-[480px] h-full shadow-2xl flex flex-col"
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-[16px] font-semibold text-slate-800">Assign Shift Groups</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={17} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
              Shift Group <span className="text-red-500">*</span>
            </label>
            {adding ? (
              <div className="flex gap-2">
                <input autoFocus className={input} value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Night Crew" />
                <button type="button" onClick={createGroup}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 rounded-md text-[13px] font-semibold whitespace-nowrap">
                  Add
                </button>
                <button type="button" onClick={() => { setAdding(false); setNewName(''); }}
                  className="border border-slate-300 px-3 rounded-md text-[13px] text-slate-600">Cancel</button>
              </div>
            ) : (
              <>
                <select className={`${input} bg-white`} value={groupId} onChange={e => setGroupId(e.target.value)}>
                  <option value="">Select</option>
                  {groups.map(g => <option key={g._id} value={g._id}>{g.name}</option>)}
                </select>
                {/* The reference's dropdown carries an Add Group button for
                    exactly this: the first group has to be created from the
                    place you first need one. */}
                <button type="button" onClick={() => setAdding(true)}
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-blue-600 hover:text-blue-700 mt-1.5">
                  <Plus size={13} /> Add Group
                </button>
              </>
            )}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
              Employee <span className="text-red-500">*</span>
            </label>
            <EmployeePicker people={people} loading={peopleLoading} value={pick}
              onChange={(id) => {
                if (id && !employeeIds.includes(String(id))) setEmployeeIds(ids => [...ids, String(id)]);
                setPick('');
              }} />
            {chosen.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {chosen.map(p => (
                  <span key={p._id} className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-full pl-2.5 pr-1 py-1 text-[12px] text-slate-700">
                    {p.employeeId} — {p.firstName} {p.lastName}
                    <button type="button" onClick={() => setEmployeeIds(ids => ids.filter(i => i !== String(p._id)))}
                      className="p-0.5 rounded-full hover:bg-slate-200 text-slate-500"><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
              Effective period <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" className={input} value={from} onChange={e => setFrom(e.target.value)} required />
              <input type="date" className={input} value={to} min={from} onChange={e => setTo(e.target.value)} />
            </div>
            <p className="text-[12px] text-slate-500 mt-1.5">
              Leave the end date empty for an open-ended membership.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50">
          <button type="submit" disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-5 py-2 rounded-md text-[14px] font-semibold">
            {saving ? 'Submitting…' : 'Submit'}
          </button>
          <button type="button" onClick={onClose}
            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-5 py-2 rounded-md text-[14px] font-semibold">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
