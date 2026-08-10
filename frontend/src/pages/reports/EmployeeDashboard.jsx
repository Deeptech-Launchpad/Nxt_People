import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, Minus, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from 'recharts';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';

// Month-over-month delta pill — a plain number alone doesn't say whether
// this month is trending up or down against last month.
function Delta({ current, previous }) {
  const diff = current - previous;
  if (diff === 0) return <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-slate-400"><Minus size={11} /> no change</span>;
  const up = diff > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[12px] font-semibold ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      <Icon size={11} /> {Math.abs(diff)} vs last month
    </span>
  );
}

function StatCard({ label, value, color = 'text-slate-800', delta }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-[13px] text-slate-500">{label}</p>
      <p className={`text-[26px] font-bold mt-1 ${color}`}>{value}</p>
      {delta && <div className="mt-1">{delta}</div>}
    </div>
  );
}

function BreakdownTable({ rows, labelHeader }) {
  const total = rows.reduce((s, r) => s + Number(r.count), 0) || 1;
  return (
    <table className="w-full text-[14px]">
      <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
        <tr><th className="text-left px-4 py-2.5">{labelHeader}</th><th className="text-right px-4 py-2.5">Count</th><th className="text-right px-4 py-2.5">Share</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rows.length === 0 ? (
          <tr><td colSpan={3} className="text-center py-8 text-slate-400">No data</td></tr>
        ) : rows.map((r, i) => (
          <tr key={i}>
            <td className="px-4 py-2.5 text-slate-700">{r.label}</td>
            <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{r.count}</td>
            <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">{Math.round((r.count / total) * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Small trend preview with a deep-link to the full report — same idea as
// Zoho's Dashboard mini-charts, minus the reference screenshot's specifics.
function MiniTrend({ title, data, color, to, navigate }) {
  return (
    <div className="border border-slate-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-bold text-slate-500 uppercase">{title}</p>
        <button onClick={() => navigate(to)} className="flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-700">
          Detailed Report <ArrowRight size={12} />
        </button>
      </div>
      {data.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-[13px]">No data in the last 6 months</div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data}>
            <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default function EmployeeDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/reports/employee/dashboard')
      .then(r => setData(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, []);

  const netChange = data ? data.newThisMonth - data.exitsThisMonth : 0;

  return (
    <ReportShell title="Dashboard" subtitle="Headcount snapshot as of now" loading={loading} switcherCategory="Employee Information">
      {data && (
        <div className="p-5 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Active Employees" value={data.active} color="text-emerald-700" />
            <StatCard label="New Hires This Month" value={data.newThisMonth} color="text-blue-700" delta={<Delta current={data.newThisMonth} previous={data.newLastMonth} />} />
            <StatCard label="Exits This Month" value={data.exitsThisMonth} color="text-red-600" delta={<Delta current={data.exitsThisMonth} previous={data.exitsLastMonth} />} />
            <StatCard label="Net Change This Month" value={netChange > 0 ? `+${netChange}` : netChange} color={netChange >= 0 ? 'text-emerald-700' : 'text-red-600'} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <MiniTrend title="Employee Addition (Last 6 Months)" data={data.last6MonthsAddition} color="#10b981" to="/reports/employee/addition-trend" navigate={navigate} />
            <MiniTrend title="Employee Attrition (Last 6 Months)" data={data.last6MonthsAttrition} color="#ef4444" to="/reports/employee/attrition-trend" navigate={navigate} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-[13px] font-bold text-slate-500 uppercase mb-2">By Department</p>
              <div className="border border-slate-100 rounded-xl overflow-hidden"><BreakdownTable rows={data.byDepartment} labelHeader="Department" /></div>
            </div>
            <div>
              <p className="text-[13px] font-bold text-slate-500 uppercase mb-2">By Gender</p>
              <div className="border border-slate-100 rounded-xl overflow-hidden"><BreakdownTable rows={data.byGender} labelHeader="Gender" /></div>
            </div>
          </div>
        </div>
      )}
    </ReportShell>
  );
}
