import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Copy, Trash2, RefreshCw, Users } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHIFT_COLORS = ['bg-brand-100 text-brand-700 border-brand-200', 'bg-emerald-100 text-emerald-700 border-emerald-200', 'bg-purple-100 text-purple-700 border-purple-200', 'bg-amber-100 text-amber-700 border-amber-200', 'bg-pink-100 text-pink-700 border-pink-200'];

function getWeekDates(monday) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function ShiftRoster() {
  const [monday, setMonday] = useState(getMondayOfWeek(new Date()));
  const [roster, setRoster] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState('');
  const [dragging, setDragging] = useState(null);
  const [copying, setCopying] = useState(false);

  const weekDates = getWeekDates(monday);
  const startDate = weekDates[0].toLocaleDateString('en-CA');
  const endDate = weekDates[6].toLocaleDateString('en-CA');

  const load = () => {
    setLoading(true);
    const params = deptFilter ? `&department=${encodeURIComponent(deptFilter)}` : '';
    Promise.all([
      api.get(`/roster?startDate=${startDate}&endDate=${endDate}${params}`),
      api.get('/shifts')
    ]).then(([rosterRes, shiftsRes]) => {
      setRoster(rosterRes.data.data || []);
      setEmployees(rosterRes.data.employees || []);
      setShifts(shiftsRes.data.data || []);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, [monday, deptFilter]);

  const prevWeek = () => { const d = new Date(monday); d.setDate(d.getDate() - 7); setMonday(d); };
  const nextWeek = () => { const d = new Date(monday); d.setDate(d.getDate() + 7); setMonday(d); };

  const getAssignment = (empId, dateStr) => roster.find(r => r.employeeId === empId && r.date?.split('T')[0] === dateStr);

  const assignShift = async (empId, dateStr, shiftId) => {
    try {
      await api.post('/roster/assign', { employeeId: empId, shiftId, date: dateStr });
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to assign'); }
  };

  const removeAssignment = async (id) => {
    try { await api.delete(`/roster/${id}`); load(); }
    catch (err) { toast.error('Failed to remove'); }
  };

  const copyWeek = async () => {
    const prevMonday = new Date(monday); prevMonday.setDate(monday.getDate() - 7);
    const prevStart = prevMonday.toLocaleDateString('en-CA');
    setCopying(true);
    try {
      const r = await api.post('/roster/copy-week', { fromStart: prevStart, toStart: startDate });
      toast.success(r.data.message);
      load();
    } catch (err) { toast.error('Failed to copy'); }
    finally { setCopying(false); }
  };

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();
  const filtered = deptFilter ? employees.filter(e => e.department === deptFilter) : employees;

  const shiftColorMap = {};
  shifts.forEach((s, i) => { shiftColorMap[s._id] = SHIFT_COLORS[i % SHIFT_COLORS.length]; });

  const weekLabel = `${weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const isCurrentWeek = getMondayOfWeek(new Date()).toLocaleDateString('en-CA') === monday.toLocaleDateString('en-CA');

  return (
    <div className="space-y-5">
      <div className="pt-5 pb-1">
        <BackButton to="/reports" label="Reports" />
      </div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-slate-800 text-xl">Shift Roster</h2>
          <p className="text-slate-400 text-base mt-0.5">Weekly shift assignment planner</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-brand-400">
            <option value="">All Departments</option>
            {departments.map(d => <option key={d}>{d}</option>)}
          </select>
          <button onClick={copyWeek} disabled={copying} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-2 rounded-xl text-base font-medium transition-colors disabled:opacity-50">
            {copying ? <RefreshCw size={14} className="animate-spin" /> : <Copy size={14} />} Copy Prev Week
          </button>
        </div>
      </div>

      {/* Shift legend */}
      <div className="flex flex-wrap gap-3">
        {shifts.map(s => (
          <div key={s._id} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border font-medium ${shiftColorMap[s._id]}`}>
            <span>{s.name}</span>
            <span className="opacity-70">{s.startTime?.substring(0,5)}–{s.endTime?.substring(0,5)}</span>
          </div>
        ))}
      </div>

      {/* Week navigation */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <button onClick={prevWeek} className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <div className="text-center">
            <p className="font-display font-semibold text-slate-800">{weekLabel}</p>
            {isCurrentWeek && <span className="text-sm bg-brand-100 text-brand-600 px-2 py-0.5 rounded-full font-medium">Current Week</span>}
          </div>
          <button onClick={nextWeek} className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16"><Users size={32} className="text-slate-200 mx-auto mb-3" /><p className="text-slate-400">No employees to display</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-500 uppercase tracking-wider w-44 sticky left-0 bg-slate-50 z-10">Employee</th>
                  {weekDates.map((d, i) => {
                    const isToday = d.toLocaleDateString('en-CA') === new Date().toLocaleDateString('en-CA');
                    const isWeekend = i >= 5;
                    return (
                      <th key={i} className={`px-2 py-3 text-center text-sm font-semibold uppercase tracking-wider min-w-[120px] ${isToday ? 'text-brand-600 bg-brand-50' : isWeekend ? 'text-slate-300' : 'text-slate-500'}`}>
                        <div>{DAYS[i]}</div>
                        <div className={`text-[13px] font-normal ${isToday ? 'text-brand-500' : 'opacity-60'}`}>{d.getDate()}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(emp => (
                  <tr key={emp._id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-100">
                      <div>
                        <p className="font-medium text-slate-700 text-base">{emp.firstName} {emp.lastName}</p>
                        <p className="text-sm text-slate-400">{emp.department}</p>
                        {emp.shiftName && <p className="text-[12px] text-brand-500 mt-0.5">Default: {emp.shiftName}</p>}
                      </div>
                    </td>
                    {weekDates.map((d, i) => {
                      const ds = d.toLocaleDateString('en-CA');
                      const assignment = getAssignment(emp._id, ds);
                      const isWeekend = i >= 5;
                      return (
                        <td key={i} className={`px-2 py-2 text-center align-middle ${isWeekend ? 'bg-slate-50/50' : ''}`}>
                          {assignment ? (
                            <div className={`relative group/cell inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-xl border font-medium ${shiftColorMap[assignment.shift?.id] || SHIFT_COLORS[0]}`}>
                              <span>{assignment.shift?.name}</span>
                              <button onClick={() => removeAssignment(assignment._id)}
                                className="opacity-0 group-hover/cell:opacity-100 transition-opacity w-4 h-4 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center">
                                <Trash2 size={9} />
                              </button>
                            </div>
                          ) : (
                            <select onChange={e => { if (e.target.value) assignShift(emp._id, ds, e.target.value); e.target.value = ''; }}
                              className="text-sm border border-dashed border-slate-200 rounded-xl px-2 py-1.5 text-slate-300 hover:border-brand-300 hover:text-brand-500 transition-colors cursor-pointer focus:outline-none bg-transparent"
                              defaultValue="">
                              <option value="" disabled>+ Assign</option>
                              {shifts.map(s => <option key={s._id} value={s._id}>{s.name} ({s.startTime?.substring(0,5)})</option>)}
                            </select>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
