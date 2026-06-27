import React, { useState, useEffect } from 'react';
import { BarChart2, Download, RefreshCw, DollarSign, Clock, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';
import * as XLSX from 'xlsx';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function PayrollReport() {
  const [data, setData] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [accruing, setAccruing] = useState(false);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [sort, setSort] = useState({ key: 'firstName', dir: 'asc' });

  const load = () => {
    setLoading(true);
    api.get(`/payroll?month=${month}&year=${year}`)
      .then(r => { setData(r.data.data || []); setMeta(r.data.meta); })
      .catch(e => toast.error(e.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [month, year]);

  const runAccrual = async () => {
    if (!window.confirm('Run monthly leave accrual for all active employees?')) return;
    setAccruing(true);
    try { const r = await api.post('/payroll/accrue'); toast.success(r.data.message); }
    catch (e) { toast.error(e.response?.data?.message || 'Accrual failed'); }
    finally { setAccruing(false); }
  };

  const exportXLSX = () => {
    const rows = sorted.map(r => ({
      'Employee ID': r.employeeId, 'Name': `${r.firstName} ${r.lastName}`,
      'Department': r.department, 'Present': r.presentDays,
      'Approved Leave': r.approvedLeaveDays, 'LOP Days': r.lopDays,
      'Late Count': r.lateDays, 'Total Hours': r.totalHours,
      'Monthly CTC': r.monthlyCTC, 'Net Payable': r.netSalary ?? 'N/A'
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Payroll');
    XLSX.writeFile(wb, `Payroll_${MONTHS[month-1]}_${year}.xlsx`);
  };

  const sorted = [...data].sort((a, b) => {
    const av = a[sort.key] ?? 0, bv = b[sort.key] ?? 0;
    return sort.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const toggleSort = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  const SI = ({ k }) => sort.key === k ? (sort.dir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>) : null;

  const totalLOP = data.reduce((s, r) => s + (r.lopDays || 0), 0);
  const totalNet = data.filter(r => r.netSalary).reduce((s, r) => s + r.netSalary, 0);
  const avgPresent = data.length > 0 ? (data.reduce((s, r) => s + r.presentDays, 0) / data.length).toFixed(1) : 0;

  const COLS = [['firstName','Employee'],['department','Dept'],['presentDays','Present'],['approvedLeaveDays','Leave'],['lopDays','LOP'],['lateDays','Late'],['totalHours','Hours'],['monthlyCTC','CTC'],['netSalary','Net Pay']];

  return (
    <div className="space-y-5">
      <div className="pt-5 pb-1">
        <BackButton to="/reports" label="Reports" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-slate-800 text-xl">Payroll Report</h2>
          <p className="text-slate-400 text-base mt-0.5">LOP-based salary calculation for {MONTHS[month-1]} {year}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={month} onChange={e => setMonth(+e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-brand-400">
            {MONTHS.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(+e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-brand-400">
            {[2023,2024,2025,2026].map(y => <option key={y}>{y}</option>)}
          </select>
          <button onClick={runAccrual} disabled={accruing} className="flex items-center gap-2 border border-emerald-200 text-emerald-600 hover:bg-emerald-50 px-3 py-2 rounded-xl text-base font-medium transition-colors disabled:opacity-50">
            <RefreshCw size={14} className={accruing ? 'animate-spin' : ''}/> Run Accrual
          </button>
          <button onClick={exportXLSX} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-xl text-base font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Download size={14}/> Export XLSX
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { icon: BarChart2, label: 'Working Days', value: meta?.totalWorkingDays ?? '—', bg: 'bg-brand-50', color: 'text-brand-600' },
          { icon: Clock, label: 'Avg Present', value: avgPresent, bg: 'bg-emerald-50', color: 'text-emerald-600' },
          { icon: TrendingDown, label: 'Total LOP', value: totalLOP.toFixed(1), bg: 'bg-red-50', color: 'text-red-500' },
          { icon: DollarSign, label: 'Total Net Pay', value: totalNet > 0 ? `₹${totalNet.toLocaleString('en-IN')}` : '—', bg: 'bg-amber-50', color: 'text-amber-600' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <div className={`w-9 h-9 ${c.bg} rounded-xl flex items-center justify-center mb-3`}><c.icon size={16} className={c.color}/></div>
            <p className="text-3xl font-display font-bold text-slate-800">{c.value}</p>
            <p className="text-sm text-slate-400 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
          ) : (
            <table className="w-full text-base">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {COLS.map(([key, label]) => (
                    <th key={key} onClick={() => toggleSort(key)} className="px-4 py-3 text-left text-sm font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-brand-600 whitespace-nowrap select-none">
                      <span className="flex items-center gap-1">{label}<SI k={key}/></span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sorted.map(r => (
                  <tr key={r._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3"><p className="font-medium text-slate-800">{r.firstName} {r.lastName}</p><p className="text-sm text-slate-400">{r.employeeId}</p></td>
                    <td className="px-4 py-3 text-slate-600 text-sm">{r.department || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-emerald-600">{r.presentDays}</td>
                    <td className="px-4 py-3 text-blue-600">{r.approvedLeaveDays}</td>
                    <td className="px-4 py-3"><span className={`font-semibold ${r.lopDays > 0 ? 'text-red-500' : 'text-slate-300'}`}>{r.lopDays}</span></td>
                    <td className="px-4 py-3 text-amber-600">{r.lateDays}</td>
                    <td className="px-4 py-3 text-slate-600">{r.totalHours}h</td>
                    <td className="px-4 py-3 text-slate-600">{r.monthlyCTC > 0 ? `₹${r.monthlyCTC.toLocaleString('en-IN')}` : '—'}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{r.netSalary ? `₹${r.netSalary.toLocaleString('en-IN')}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 text-sm text-slate-400 flex justify-between">
          <span>{data.length} employees · LOP = Working Days − (Present + Leave)</span>
          <span>Set CTC in employee record to see net pay</span>
        </div>
      </div>
    </div>
  );
}
