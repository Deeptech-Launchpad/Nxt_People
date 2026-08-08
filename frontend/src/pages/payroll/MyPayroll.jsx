/**
 * Employee → My Payroll / Payslips
 * Wired to the real payslip system (/api/payroll/my), not the disconnected
 * legacy /api/payslips FY-archive endpoint this page used to (wrongly) call.
 */
import React, { useEffect, useState } from 'react';
import { FileText, Download, Eye } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { fmtINR, StatusPill } from './_shared';
import { PayslipModal } from './PayrollRun';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function MyPayroll() {
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [year, setYear] = useState('all');

  const load = () => {
    setLoading(true);
    setLoadError(false);
    api.get('/payroll/my')
      .then(r => setPayslips(r.data.data || []))
      .catch(err => {
        setLoadError(true);
        toast.error(err.response?.data?.message || 'Failed to load payslips');
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const years = [...new Set(payslips.map(p => p.payYear))].sort((a, b) => b - a);
  const filtered = year === 'all' ? payslips : payslips.filter(p => String(p.payYear) === String(year));

  const downloadPdf = async (id) => {
    if (downloadingId) return;
    setDownloadingId(id);
    try {
      const r = await api.get(`/payroll/my/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `payslip-${id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.message || 'PDF download failed');
    } finally { setDownloadingId(null); }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800">My Payroll</h1>
          <p className="text-[15px] text-slate-500 mt-1">Your payslips, once locked by HR.</p>
        </div>
        {years.length > 1 && (
          <select value={year} onChange={e => setYear(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[14px] font-semibold bg-white">
            <option value="all">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-[3px] border-[#1a73e8] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : loadError ? (
          <div className="p-14 text-center">
            <FileText size={28} className="text-rose-200 mx-auto mb-3" />
            <p className="text-[15px] font-semibold text-slate-500">Couldn't load your payslips</p>
            <button onClick={load} className="mt-3 text-[14px] font-semibold text-blue-600 hover:text-blue-700">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-14 text-center">
            <FileText size={28} className="text-slate-200 mx-auto mb-3" />
            <p className="text-[15px] font-semibold text-slate-500">No payslips yet</p>
            <p className="text-[14px] text-slate-400 mt-1">Payslips appear here once HR generates and locks them.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Month', 'Slip #', 'Gross', 'Net Pay', 'Status', ''].map(h => (
                    <th key={h} className={`px-5 py-3 text-[13px] font-semibold text-slate-500 uppercase tracking-wider ${['Gross', 'Net Pay'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(p => (
                  <tr key={p._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-[15px] font-semibold text-[#1a73e8]">{MONTHS[p.payMonth]} {p.payYear}</span>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] font-mono text-slate-500">{p.slipNumber || '—'}</td>
                    <td className="px-5 py-3.5 text-[15px] text-slate-700 text-right tabular-nums">{fmtINR(p.grossEarnings)}</td>
                    <td className="px-5 py-3.5 text-[15px] font-bold text-slate-800 text-right tabular-nums">{fmtINR(p.netPay)}</td>
                    <td className="px-5 py-3.5"><StatusPill status={p.status} /></td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setViewing(p)} title="View" disabled={downloadingId === p._id} className="text-slate-500 hover:text-slate-800 disabled:opacity-40"><Eye size={15} /></button>
                        <button onClick={() => downloadPdf(p._id)} title="Download PDF" disabled={downloadingId === p._id} className="text-slate-500 hover:text-slate-800 disabled:opacity-40"><Download size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && <PayslipModal id={viewing._id} onClose={() => setViewing(null)} adminScope={false} />}
    </div>
  );
}
