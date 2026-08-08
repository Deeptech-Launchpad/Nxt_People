/**
 * Admin → Compliance Reports
 * Quick CSV exports of the four standard Indian payroll filings for any
 * given month. Each report pulls from locked/paid payslips only, so
 * draft slips never leak into a return that's filed with the govt.
 */
import React, { useState, useEffect } from 'react';
import { Download, Calendar, Building2, ShieldCheck, FileSpreadsheet, FileBarChart, Banknote, User } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { MONTH_NAMES, currentFY } from './_shared';

// Written out as literal class strings (not built via template interpolation)
// so Tailwind's build-time scanner can actually find and generate them —
// `bg-${accent}-50` etc. isn't a real string anywhere in the source, so
// Tailwind can silently drop classes for any accent that doesn't happen to
// appear literally elsewhere in the codebase (this bit the NEFT/violet card).
const ACCENT_CLASSES = {
  emerald: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700',
  blue:    'bg-blue-50 hover:bg-blue-100 text-blue-700',
  rose:    'bg-rose-50 hover:bg-rose-100 text-rose-700',
  amber:   'bg-amber-50 hover:bg-amber-100 text-amber-700',
  violet:  'bg-violet-50 hover:bg-violet-100 text-violet-700',
};

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
  {
    type: 'neft',
    title: 'NEFT Bank File',
    desc: 'Salary credit file for bank bulk upload. Includes beneficiary, A/c, IFSC, amount.',
    icon: Banknote, color: 'from-violet-500 to-indigo-600', accent: 'violet',
    warnOnReexport: true,
  },
];

export default function ComplianceReports() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear]   = useState(today.getFullYear());
  const [downloading, setDownloading] = useState(null);

  // For non-NEFT exports just hit the endpoint directly.
  // NEFT is special: the backend returns 409 if some slips are already
  // exported, so we run a pre-flight, surface a confirmation prompt to
  // the admin, and only then send the actual download with ?force=true.
  const triggerCsv = async (type, force = false) => {
    const qs = `month=${month}&year=${year}${force ? '&force=true' : ''}`;
    const r = await api.get(`/payroll/admin/reports/${type}?${qs}`, { responseType: 'blob' });
    const objectUrl = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${type}-${String(month).padStart(2,'0')}-${year}.csv`;
    a.click();
    URL.revokeObjectURL(objectUrl);
    toast.success(`${type.toUpperCase()} report downloaded`);
  };

  const download = async (type) => {
    setDownloading(type);
    try {
      if (type === 'neft') {
        // Preflight to detect prior export. If found, ask admin to confirm.
        const status = await api.get(`/payroll/admin/reports/neft/status?month=${month}&year=${year}`);
        if (status.data.alreadyExported > 0) {
          const exportedAt = status.data.lastExportedAt
            ? new Date(status.data.lastExportedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
            : 'previously';
          const ok = window.confirm(
            `⚠ ${status.data.alreadyExported} of ${status.data.total} payslip(s) for this month were already sent to the bank on ${exportedAt}.\n\n` +
            `Downloading again and uploading to the bank could DOUBLE-PAY salaries.\n\n` +
            `Continue anyway?`
          );
          if (!ok) { setDownloading(null); return; }
          await triggerCsv('neft', true);
        } else {
          await triggerCsv('neft', false);
        }
      } else {
        await triggerCsv(type, false);
      }
    } catch (err) {
      // Backend returns 409 + JSON body when force is needed.
      let msg = 'Failed';
      if (err.response?.data instanceof Blob) {
        try { msg = JSON.parse(await err.response.data.text()).message || msg; } catch (_) {}
      } else {
        msg = err.response?.data?.message || err.message || msg;
      }
      toast.error(msg);
    } finally { setDownloading(null); }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-slate-800">Compliance Reports</h1>
        <p className="text-[15px] text-slate-500 mt-1">
          Download statutory-filing-ready CSVs. Includes only locked / paid payslips — drafts are excluded so you never file unfinalised data.
        </p>
      </div>

      {/* Period selector */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-slate-400" />
          <p className="text-[15px] font-bold text-slate-800">Reporting period</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="bg-transparent text-[15px] font-semibold focus:outline-none">
            {MONTH_NAMES.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="bg-transparent text-[15px] font-semibold focus:outline-none">
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
                  <h3 className="text-[17px] font-bold text-slate-800">{r.title}</h3>
                  <p className="text-[14px] text-slate-500 mt-0.5 leading-relaxed">{r.desc}</p>
                  <button
                    onClick={() => download(r.type)}
                    disabled={isDownloading}
                    className={`mt-3 inline-flex items-center gap-1.5 ${ACCENT_CLASSES[r.accent]} text-[14px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60`}
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
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[13px] text-slate-500">
        💡 These are register-style CSVs you can pass to your CA or upload to the respective portal. For Tamil Nadu PT, the filing date is monthly by the 15th. For PF, by the 15th. For ESI, by the 15th. TDS challan by the 7th.
      </div>

      <EmployeeSummaryReports />
    </div>
  );
}

/** Per-employee annual EPF / ESI contribution summary PDFs — separate from
 *  the monthly org-wide CSV registers above, this is a document employees
 *  sometimes need for loan applications, visa proof of income, etc. */
function EmployeeSummaryReports() {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [fy, setFy] = useState(currentFY());
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    api.get('/payroll/admin/employees')
      .then(r => setEmployees(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load employees'));
  }, []);

  const download = async (kind) => {
    if (!employeeId) { toast.error('Pick an employee first'); return; }
    setDownloading(kind);
    try {
      const r = await api.get(`/payroll/reports/${kind}-summary/${employeeId}?fy=${fy}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `${kind}-summary-${fy}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      let msg = 'Failed';
      if (err.response?.data instanceof Blob) {
        try { msg = JSON.parse(await err.response.data.text()).message || msg; } catch (_) {}
      } else { msg = err.response?.data?.message || msg; }
      toast.error(msg);
    } finally { setDownloading(null); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <h3 className="text-[17px] font-bold text-slate-800">Employee EPF / ESI Summary</h3>
      <p className="text-[14px] text-slate-500 mt-0.5 mb-4">Annual per-employee contribution statement — for loan applications, income proof, etc.</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <User size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
            className="pl-7 pr-3 py-2 border border-slate-200 rounded-lg text-[14px] bg-white min-w-[220px]">
            <option value="">Select employee…</option>
            {employees.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName} ({e.employeeId})</option>)}
          </select>
        </div>
        <select value={fy} onChange={e => setFy(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-2 text-[14px] bg-white">
          {[currentFY(), '2025-26', '2024-25'].filter((v, i, a) => a.indexOf(v) === i).map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <button onClick={() => download('epf')} disabled={downloading === 'epf'}
          className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[14px] font-semibold px-3 py-2 rounded-lg disabled:opacity-60">
          <Download size={12} /> {downloading === 'epf' ? 'Generating…' : 'EPF Summary'}
        </button>
        <button onClick={() => download('esi')} disabled={downloading === 'esi'}
          className="flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[14px] font-semibold px-3 py-2 rounded-lg disabled:opacity-60">
          <Download size={12} /> {downloading === 'esi' ? 'Generating…' : 'ESI Summary'}
        </button>
      </div>
    </div>
  );
}
