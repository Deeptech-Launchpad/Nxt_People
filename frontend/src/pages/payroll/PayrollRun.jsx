/**
 * Payroll Run + Admin Payslips Viewer
 *
 * Single page that does two things admins care about:
 *   1. Pick a month/year and click "Run Payroll" → backend computes
 *      payslips from each employee's salary_structure + attendance LOP.
 *   2. Browse the resulting payslips: view, download PDF, lock, mark
 *      paid, or delete (drafts only).
 *
 * Status lifecycle is rendered as a coloured pill (draft / locked / paid).
 */
import React, { useEffect, useState, useMemo } from 'react';
import { Play, Search, Eye, Lock, CheckCircle2, Trash2, Download, RefreshCw, FileText, Filter, AlertCircle, MailCheck } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { MONTH_NAMES, SHORT_MONTHS, fmtINR, fmtINRshort, StatusPill, StatCard } from './_shared';

export default function PayrollRun() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear]   = useState(today.getFullYear());
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(false);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewing, setViewing]   = useState(null);

  const load = () => {
    setLoading(true);
    api.get(`/payroll/admin/payslips?month=${month}&year=${year}`)
      .then(r => setPayslips(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [month, year]);

  const runPayroll = async (force = false) => {
    if (!confirm(`Run payroll for ${MONTH_NAMES[month]} ${year}?\n\n${force ? '⚠️ Existing DRAFT payslips will be overwritten. Locked/paid are protected.' : 'Existing payslips will be skipped — flip the Force toggle to re-run.'}`)) return;
    setRunning(true);
    try {
      const r = await api.post('/payroll/admin/run-month', { month, year, force });
      const { created, updated, skipped, errors } = r.data.results;
      toast.success(`Generated: ${created} new · ${updated} updated · ${skipped} skipped${errors.length ? ` · ${errors.length} errors` : ''}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Run failed');
    } finally { setRunning(false); }
  };

  const lockPayslip = async (id) => {
    if (!confirm('Lock this payslip? Employee will be able to see it once locked.')) return;
    try {
      await api.put(`/payroll/admin/payslips/${id}/lock`);
      toast.success('Locked');
      load();
    } catch (err) {
      // Manager-approval gate returns a distinct code so we can show a
      // clearer message than just "Lock failed".
      if (err.response?.data?.code === 'MANAGER_APPROVAL_REQUIRED') {
        toast.error(err.response.data.message, { duration: 6000 });
      } else {
        toast.error(err.response?.data?.message || 'Lock failed');
      }
    }
  };

  // Open the EXACT email body the employee would receive on lock in a new
  // tab. Lets admin spot wrong TDS / net pay / formatting before the
  // fire-and-forget email goes out.
  const previewEmail = (id) => {
    const token = localStorage.getItem('nxt_token');
    // We have to use fetch instead of api.get because we want the HTML to
    // open in a new tab, not parse as JSON. Token must be appended as a
    // query param since new windows can't carry Authorization headers.
    // For security, we'll fetch as a blob and use a one-shot data URL.
    api.get(`/payroll/admin/payslips/${id}/preview-email`, { responseType: 'text' })
      .then(r => {
        const blob = new Blob([r.data], { type: 'text/html' });
        const url  = URL.createObjectURL(blob);
        const w    = window.open(url, '_blank', 'width=720,height=900,scrollbars=yes');
        // Revoke after 1 minute — gives the window time to render.
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        if (!w) toast.error('Allow popups for this site to preview the email.');
      })
      .catch(err => toast.error(err.response?.data?.message || 'Preview failed'));
    // Silence unused var lint
    void token;
  };

  const markPaid = async (id) => {
    if (!confirm('Mark this payslip as paid?')) return;
    try {
      await api.put(`/payroll/admin/payslips/${id}/mark-paid`);
      toast.success('Marked paid');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Mark paid failed'); }
  };

  const removeDraft = async (id) => {
    if (!confirm('Delete this draft payslip? This cannot be undone.')) return;
    try {
      await api.delete(`/payroll/admin/payslips/${id}`);
      toast.success('Deleted');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Delete failed'); }
  };

  const downloadPdf = async (id) => {
    try {
      const r = await api.get(`/payroll/admin/payslips/${id}/pdf`, { responseType: 'blob' });
      const objectUrl = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `payslip-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      toast.error(err.response?.data?.message || 'PDF download failed');
    }
  };

  // Filtering + aggregation in memo so big lists stay snappy.
  const filtered = useMemo(() => {
    let rows = payslips;
    if (statusFilter !== 'all') rows = rows.filter(p => p.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(p =>
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
        (p.employeeCode || '').toLowerCase().includes(q) ||
        (p.department || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [payslips, search, statusFilter]);

  const stats = useMemo(() => {
    const total = payslips.length;
    const draft = payslips.filter(p => p.status === 'draft').length;
    const locked = payslips.filter(p => p.status === 'locked').length;
    const paid = payslips.filter(p => p.status === 'paid').length;
    const gross = payslips.reduce((s, p) => s + Number(p.grossEarnings || 0), 0);
    const net   = payslips.reduce((s, p) => s + Number(p.netPay || 0), 0);
    return { total, draft, locked, paid, gross, net };
  }, [payslips]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800">Payroll · Run & Payslips</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Generate, review, lock, and pay employee salaries for any month.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
          <button
            onClick={() => runPayroll(false)}
            disabled={running}
            className="flex items-center gap-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg text-[13px] font-semibold shadow hover:shadow-md transition-all disabled:opacity-60"
          >
            <Play size={14} /> {running ? 'Running…' : 'Run Payroll'}
          </button>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Payslips" value={stats.total} icon={FileText} />
        <StatCard label="Draft / Locked / Paid"
                  value={`${stats.draft} · ${stats.locked} · ${stats.paid}`}
                  color={stats.draft > 0 ? 'text-amber-700' : 'text-emerald-700'} />
        <StatCard label="Gross Payroll" value={fmtINRshort(stats.gross)} color="text-blue-700" hint={fmtINR(stats.gross)} />
        <StatCard label="Net Payable"   value={fmtINRshort(stats.net)}   color="text-emerald-700" hint={fmtINR(stats.net)} />
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search name / ID / dept"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-0.5">
            {['all', 'draft', 'locked', 'paid'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 text-[11.5px] font-semibold rounded transition-colors capitalize ${
                  statusFilter === s ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                }`}
              >{s}</button>
            ))}
          </div>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-800 border border-slate-200 px-2.5 py-1.5 rounded-lg">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-slate-50 text-[11.5px] font-bold text-slate-600 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2.5">Employee</th>
              <th className="px-4 py-2.5">Designation</th>
              <th className="px-4 py-2.5 text-right">Gross</th>
              <th className="px-4 py-2.5 text-right">Deductions</th>
              <th className="px-4 py-2.5 text-right">Net Pay</th>
              <th className="px-4 py-2.5">LOP</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="py-10 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-slate-400">
                <div className="flex flex-col items-center gap-2">
                  <FileText size={32} className="text-slate-300" />
                  <p>No payslips for {MONTH_NAMES[month]} {year}.</p>
                  <p className="text-[11.5px]">Click "Run Payroll" above to generate them.</p>
                </div>
              </td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800">{p.firstName} {p.lastName}</div>
                  <div className="text-[11px] text-slate-400 font-mono">{p.employeeCode}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{p.designation || '—'}</div>
                  <div className="text-[11px] text-slate-400">{p.department || ''}</div>
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtINR(p.grossEarnings)}</td>
                <td className="px-4 py-3 text-right font-medium text-red-600">{fmtINR(p.totalDeductions)}</td>
                <td className="px-4 py-3 text-right font-bold text-emerald-700">{fmtINR(p.netPay)}</td>
                <td className="px-4 py-3 text-[12px]">
                  {Number(p.lopDays) > 0 ? (
                    <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                      <AlertCircle size={11} /> {Number(p.lopDays)}d
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3"><StatusPill status={p.status} /></td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <IconBtn title="View" onClick={() => setViewing(p)}><Eye size={13} /></IconBtn>
                    <IconBtn title="Download PDF" onClick={() => downloadPdf(p.id)}><Download size={13} /></IconBtn>
                    {p.status === 'draft' && (
                      <>
                        <IconBtn title="Preview email (as employee will see)" onClick={() => previewEmail(p.id)} color="text-indigo-600 hover:bg-indigo-50"><MailCheck size={13} /></IconBtn>
                        <IconBtn title="Lock" onClick={() => lockPayslip(p.id)} color="text-blue-600 hover:bg-blue-50"><Lock size={13} /></IconBtn>
                        <IconBtn title="Delete" onClick={() => removeDraft(p.id)} color="text-red-500 hover:bg-red-50"><Trash2 size={13} /></IconBtn>
                      </>
                    )}
                    {p.status === 'locked' && (
                      <IconBtn title="Mark paid" onClick={() => markPaid(p.id)} color="text-emerald-600 hover:bg-emerald-50"><CheckCircle2 size={13} /></IconBtn>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Force-rerun hint */}
      {stats.draft > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3 text-[12.5px]">
          <Filter size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-amber-800">{stats.draft} draft payslip{stats.draft > 1 ? 's' : ''} pending</p>
            <p className="text-amber-700 mt-0.5">Drafts are admin-only — employees can't see them until you click the lock icon. To re-compute (e.g. after salary edits or backdated leave approvals), use the Force re-run button:</p>
          </div>
          <button
            onClick={() => runPayroll(true)}
            disabled={running}
            className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white text-[11.5px] font-bold px-2.5 py-1.5 rounded disabled:opacity-60"
          >
            <RefreshCw size={11} /> Force Re-run
          </button>
        </div>
      )}

      {viewing && <PayslipModal id={viewing.id} onClose={() => setViewing(null)} adminScope />}
    </div>
  );
}

function IconBtn({ title, onClick, children, color = 'text-slate-500 hover:bg-slate-100' }) {
  return (
    <button type="button" title={title} onClick={onClick} className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${color}`}>
      {children}
    </button>
  );
}

function PeriodPicker({ month, year, onChange }) {
  const years = [year - 1, year, year + 1];
  return (
    <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1.5">
      <select value={month} onChange={e => onChange(Number(e.target.value), year)} className="bg-transparent text-[13px] font-semibold focus:outline-none">
        {MONTH_NAMES.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select value={year} onChange={e => onChange(month, Number(e.target.value))} className="bg-transparent text-[13px] font-semibold focus:outline-none">
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

/* ── Payslip viewer modal (admin scope) ────────────────────────────────── */
export function PayslipModal({ id, onClose, adminScope = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = adminScope ? `/payroll/admin/payslips/${id}` : `/payroll/my/${id}`;
    api.get(url)
      .then(r => setData(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id, adminScope]);

  const downloadPdf = async () => {
    try {
      const path = adminScope ? `/payroll/admin/payslips/${id}/pdf` : `/payroll/my/${id}/pdf`;
      const r = await api.get(path, { responseType: 'blob' });
      const objectUrl = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `payslip-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      toast.error(err.response?.data?.message || 'PDF download failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Hero header — same colour identity as the PDF for consistency */}
        <div className="bg-gradient-to-r from-[#1a2040] to-[#2d3578] text-white px-6 py-5 flex items-start justify-between">
          <div>
            <p className="text-[11.5px] uppercase tracking-wider text-blue-200 font-bold">Payslip</p>
            <p className="text-[20px] font-bold mt-1">
              {data ? `${MONTH_NAMES[data.pay_month]} ${data.pay_year}` : 'Loading…'}
            </p>
            {data && (
              <p className="text-[12px] text-blue-100 mt-0.5">
                {data.firstName} {data.lastName} <span className="text-blue-300 font-mono ml-1">{data.employeeCode}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadPdf} className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg">
              <Download size={13} /> PDF
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center">✕</button>
          </div>
        </div>
        <div className="overflow-y-auto p-6">
          {loading || !data ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : <PayslipBody p={data} />}
        </div>
      </div>
    </div>
  );
}

/** Pure visual body for the payslip — used both inside the admin modal
 *  and on the employee MyPayroll detail page. */
export function PayslipBody({ p }) {
  const earnings = [
    ['Basic',             p.basic],
    ['HRA',               p.hra],
    ['Conveyance',        p.conveyance],
    ['Medical',           p.medical],
    ['Special Allowance', p.special_allowance],
    ['Other Allowances',  p.other_allowances],
  ];
  const deductions = [
    ['PF (Employee)',     p.pf_employee],
    ['ESI (Employee)',    p.esi_employee],
    ['Professional Tax',  p.professional_tax],
    ['TDS',               p.tds],
    ['LOP Adjustment',    p.lop_amount],
  ];
  return (
    <div className="space-y-4">
      {/* Employee block */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12.5px]">
        <KV label="Designation"  value={p.designation} />
        <KV label="Department"   value={p.department} />
        <KV label="PAN"          value={p.pan_number} />
        <KV label="UAN"          value={p.uan_number} />
        <KV label="Bank Name"    value={p.bank_name} />
        <KV label="Bank Account" value={p.bank_account} />
        <KV label="Bank IFSC"    value={p.bank_ifsc} />
        <KV label="Days Worked"  value={`${p.present_days} / ${p.working_days}${Number(p.lop_days) > 0 ? ` · LOP ${p.lop_days}` : ''}`} />
      </div>

      {/* Earnings / Deductions */}
      <div className="grid md:grid-cols-2 gap-4">
        <Block title="Earnings" tint="emerald" rows={earnings} total={p.gross_earnings} />
        <Block title="Deductions" tint="rose" rows={deductions} total={p.total_deductions} />
      </div>

      {/* Net pay */}
      <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 border border-blue-200 rounded-xl px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-blue-700">Net Pay</p>
          <p className="text-[11px] text-blue-500 mt-0.5">Amount credited to bank</p>
        </div>
        <p className="text-[26px] font-bold text-blue-800">{fmtINR(p.net_pay)}</p>
      </div>
    </div>
  );
}

function KV({ label, value }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-slate-400 w-28 flex-shrink-0">{label}:</span>
      <span className="text-slate-700 font-medium truncate">{value || '—'}</span>
    </div>
  );
}

function Block({ title, tint, rows, total }) {
  const palette = tint === 'emerald'
    ? { head: 'bg-emerald-50 text-emerald-800', amt: 'text-emerald-700' }
    : { head: 'bg-rose-50 text-rose-800', amt: 'text-rose-700' };
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className={`px-4 py-2 text-[11.5px] font-bold uppercase tracking-wider ${palette.head}`}>{title}</div>
      <div className="divide-y divide-slate-100">
        {rows.map(([label, amt]) => (
          <div key={label} className="px-4 py-2 flex items-center justify-between text-[12.5px]">
            <span className="text-slate-600">{label}</span>
            <span className={`font-semibold ${palette.amt}`}>{fmtINR(amt)}</span>
          </div>
        ))}
        <div className="px-4 py-2.5 flex items-center justify-between text-[13px] bg-slate-50 font-bold text-slate-800">
          <span>Total</span>
          <span className={palette.amt}>{fmtINR(total)}</span>
        </div>
      </div>
    </div>
  );
}
