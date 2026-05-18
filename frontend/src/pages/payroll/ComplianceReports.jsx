/**
 * Admin → Compliance Reports
 * Quick CSV exports of the four standard Indian payroll filings for any
 * given month. Each report pulls from locked/paid payslips only, so
 * draft slips never leak into a return that's filed with the govt.
 */
import React, { useState } from 'react';
import { Download, Calendar, Building2, ShieldCheck, FileSpreadsheet, FileBarChart } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { MONTH_NAMES } from './_shared';

const REPORTS = [
  {
    type: 'pf',
    title: 'PF Return',
    desc: 'Provident Fund employee contribution register. UAN, Basic, PF amount per employee.',
    icon: ShieldCheck, color: 'from-emerald-500 to-teal-600', accent: 'emerald',
  },
  {
    type: 'esi',
    title: 'ESI Return',
    desc: 'Employees State Insurance for employees with gross ≤ ₹21,000/mo.',
    icon: Building2, color: 'from-blue-500 to-indigo-600', accent: 'blue',
  },
  {
    type: 'tds',
    title: 'TDS Register',
    desc: 'Income tax deducted at source, by PAN. Used for Form 24Q filing.',
    icon: FileBarChart, color: 'from-rose-500 to-pink-600', accent: 'rose',
  },
  {
    type: 'pt',
    title: 'Professional Tax',
    desc: 'State-specific professional tax register. Tamil Nadu defaults to ₹208/mo.',
    icon: FileSpreadsheet, color: 'from-amber-500 to-orange-600', accent: 'amber',
  },
];

export default function ComplianceReports() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear]   = useState(today.getFullYear());
  const [downloading, setDownloading] = useState(null);

  const download = async (type) => {
    setDownloading(type);
    try {
      const url = api.defaults.baseURL + `/payroll/admin/reports/${type}?month=${month}&year=${year}`;
      const token = localStorage.getItem('nxt_access_token');
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Download failed');
      const blob = await r.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${type}-${String(month).padStart(2,'0')}-${year}.csv`;
      a.click();
      URL.revokeObjectURL(objectUrl);
      toast.success(`${type.toUpperCase()} report downloaded`);
    } catch (err) {
      toast.error(err.message || 'Failed');
    } finally { setDownloading(null); }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-slate-800">Compliance Reports</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          Download statutory-filing-ready CSVs. Includes only locked / paid payslips — drafts are excluded so you never file unfinalised data.
        </p>
      </div>

      {/* Period selector */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-slate-400" />
          <p className="text-[13px] font-bold text-slate-800">Reporting period</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="bg-transparent text-[13px] font-semibold focus:outline-none">
            {MONTH_NAMES.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="bg-transparent text-[13px] font-semibold focus:outline-none">
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid md:grid-cols-2 gap-4">
        {REPORTS.map(r => {
          const Icon = r.icon;
          const isDownloading = downloading === r.type;
          return (
            <div key={r.type} className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${r.color} text-white flex items-center justify-center flex-shrink-0 shadow`}>
                  <Icon size={22} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-bold text-slate-800">{r.title}</h3>
                  <p className="text-[12.5px] text-slate-500 mt-0.5 leading-relaxed">{r.desc}</p>
                  <button
                    onClick={() => download(r.type)}
                    disabled={isDownloading}
                    className={`mt-3 inline-flex items-center gap-1.5 bg-${r.accent}-50 hover:bg-${r.accent}-100 text-${r.accent}-700 text-[12px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60`}
                  >
                    <Download size={12} /> {isDownloading ? 'Generating…' : 'Download CSV'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footnote */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[11.5px] text-slate-500">
        💡 These are register-style CSVs you can pass to your CA or upload to the respective portal. For Tamil Nadu PT, the filing date is monthly by the 15th. For PF, by the 15th. For ESI, by the 15th. TDS challan by the 7th.
      </div>
    </div>
  );
}
