/**
 * Employee → My Payroll
 * Shows every locked / paid payslip in reverse chronological order. The
 * current-FY YTD summary sits up top. Clicking a row opens the same
 * visual payslip used in the admin modal, scoped to /my so an employee
 * can only ever see their own slips.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { Wallet, TrendingUp, Calendar, Download, ChevronRight, FileText } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { MONTH_NAMES, SHORT_MONTHS, fmtINR, fmtINRshort, StatusPill, StatCard } from './_shared';
import { PayslipBody } from './PayrollRun';

export default function MyPayroll() {
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail]     = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get('/payroll/my')
      .then(r => setPayslips(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return setDetail(null);
    api.get(`/payroll/my/${selected.id}`)
      .then(r => setDetail(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed'));
  }, [selected]);

  const downloadPdf = (id) => {
    const url = api.defaults.baseURL + `/payroll/my/${id}/pdf`;
    const token = localStorage.getItem('nxt_access_token');
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `payslip-${id}.pdf`;
        a.click();
        URL.revokeObjectURL(objectUrl);
      })
      .catch(() => toast.error('PDF download failed'));
  };

  // YTD totals for the current FY (Apr–Mar). Reuses the listing data
  // we already fetched — no extra round-trip.
  const ytd = useMemo(() => {
    const today = new Date();
    const fyStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    const inFy = (p) => {
      // April of fyStartYear → March of fyStartYear+1
      if (p.payYear === fyStartYear   && p.payMonth >= 4)  return true;
      if (p.payYear === fyStartYear+1 && p.payMonth <= 3)  return true;
      return false;
    };
    const fySlips = payslips.filter(inFy);
    const gross = fySlips.reduce((s, p) => s + Number(p.grossEarnings || 0), 0);
    const ded   = fySlips.reduce((s, p) => s + Number(p.totalDeductions || 0), 0);
    const net   = fySlips.reduce((s, p) => s + Number(p.netPay || 0), 0);
    return {
      months: fySlips.length, gross, ded, net,
      fyLabel: `FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`,
    };
  }, [payslips]);

  const latest = payslips[0];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[20px] font-bold text-slate-800">My Payroll</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          Your monthly payslips. Click any row to see the full breakdown or download as PDF.
        </p>
      </div>

      {/* Hero — latest month if any */}
      {latest && (
        <div className="bg-gradient-to-br from-[#1a2040] via-[#243064] to-[#2d3578] text-white rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute -right-10 -top-10 opacity-10">
            <Wallet size={180} strokeWidth={1} />
          </div>
          <div className="relative">
            <p className="text-[11.5px] uppercase tracking-wider text-blue-200 font-bold">Latest payslip</p>
            <p className="text-[14px] text-blue-100 mt-1">{MONTH_NAMES[latest.payMonth]} {latest.payYear}</p>
            <p className="text-[36px] font-bold mt-2">{fmtINR(latest.netPay)}</p>
            <p className="text-[12.5px] text-blue-200">
              Gross {fmtINR(latest.grossEarnings)} − Deductions {fmtINR(latest.totalDeductions)}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => setSelected(latest)}
                className="bg-white/15 hover:bg-white/25 text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg"
              >View details</button>
              <button
                onClick={() => downloadPdf(latest.id)}
                className="flex items-center gap-1.5 bg-white text-blue-700 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
              ><Download size={13} /> Download PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* YTD strip */}
      {ytd.months > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label={`${ytd.fyLabel} · Months`} value={`${ytd.months} slip${ytd.months > 1 ? 's' : ''}`} icon={Calendar} />
          <StatCard label="Gross (YTD)"      value={fmtINRshort(ytd.gross)} color="text-slate-700" hint={fmtINR(ytd.gross)} />
          <StatCard label="Deductions (YTD)" value={fmtINRshort(ytd.ded)}   color="text-rose-700" hint={fmtINR(ytd.ded)} />
          <StatCard label="Take-home (YTD)"  value={fmtINRshort(ytd.net)}   color="text-emerald-700" hint={fmtINR(ytd.net)} icon={TrendingUp} />
        </div>
      )}

      {/* History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-slate-800">All Payslips</h3>
          <p className="text-[11.5px] text-slate-500">{payslips.length} total</p>
        </div>
        {loading ? (
          <div className="py-10 text-center text-slate-400">Loading…</div>
        ) : payslips.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <FileText size={32} className="mx-auto text-slate-300 mb-2" />
            <p>No payslips yet.</p>
            <p className="text-[11.5px] mt-1">You'll see them here once HR runs payroll and locks the month.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {payslips.map(p => (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className="w-full px-4 py-3 hover:bg-slate-50 flex items-center justify-between text-left transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-700 flex flex-col items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold uppercase">{SHORT_MONTHS[p.payMonth]}</span>
                    <span className="text-[12px] font-bold leading-none">{String(p.payYear).slice(2)}</span>
                  </div>
                  <div>
                    <p className="text-[13.5px] font-bold text-slate-800">{MONTH_NAMES[p.payMonth]} {p.payYear}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusPill status={p.status} />
                      {p.lockedAt && <p className="text-[11px] text-slate-400">Locked {new Date(p.lockedAt).toLocaleDateString('en-GB')}</p>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[15px] font-bold text-emerald-700">{fmtINR(p.netPay)}</p>
                    <p className="text-[11px] text-slate-400">Gross {fmtINR(p.grossEarnings)}</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-300" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-[#1a2040] to-[#2d3578] text-white px-6 py-5 flex items-start justify-between">
              <div>
                <p className="text-[11.5px] uppercase tracking-wider text-blue-200 font-bold">Payslip</p>
                <p className="text-[20px] font-bold mt-1">{MONTH_NAMES[selected.payMonth]} {selected.payYear}</p>
                <p className="text-[12px] text-blue-100 mt-0.5">Status: <StatusPill status={selected.status} /></p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => downloadPdf(selected.id)} className="flex items-center gap-1.5 bg-white text-blue-700 text-[12px] font-semibold px-3 py-1.5 rounded-lg">
                  <Download size={13} /> PDF
                </button>
                <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center">✕</button>
              </div>
            </div>
            <div className="overflow-y-auto p-6">
              {detail ? <PayslipBody p={detail} /> : <div className="py-10 text-center text-slate-400">Loading…</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
