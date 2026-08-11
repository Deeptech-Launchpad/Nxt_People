import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import MiniDonut from './MiniDonut';

function growthText(v) {
  if (v === null || v === undefined) return '—';
  return `${v > 0 ? '+' : ''}${v}%`;
}
function growthColor(v) {
  if (v === null || v === undefined) return 'text-slate-400';
  return v >= 0 ? 'text-emerald-600' : 'text-red-600';
}

// 2-row (This Year / Last Year) x 2-col (Month(<current month>) / YoY)
// table — matches Zoho's stat widget structure exactly, instead of a
// single-value card.
function MetricCard({ title, metric, monthLabel }) {
  const rows = [
    { label: metric.thisYear.year, month: metric.thisYear.month, yoy: metric.thisYear.yoy },
    { label: metric.lastYear.year, month: metric.lastYear.month, yoy: metric.lastYear.yoy },
  ];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-[13px] font-bold text-slate-500 uppercase mb-3">{title}</p>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-slate-400">
            <th className="text-left font-medium pb-2"></th>
            <th className="text-right font-medium pb-2">Month ({monthLabel})</th>
            <th className="text-right font-medium pb-2">YOY</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map(row => (
            <tr key={row.label}>
              <td className="py-1.5 font-semibold text-slate-600">{row.label}</td>
              <td className="py-1.5 text-right tabular-nums">
                {row.month.value} <span className={`font-semibold ${growthColor(row.month.growth)}`}>{growthText(row.month.growth)}</span>
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {row.yoy.value} <span className={`font-semibold ${growthColor(row.yoy.growth)}`}>{growthText(row.yoy.growth)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
        <ComboTrendChart data={data} xKey="month" barColor={color} lineLabel="Percentage" />
      )}
    </div>
  );
}

function MiniExperienceExit({ data, to, navigate }) {
  return (
    <div className="border border-slate-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-bold text-slate-500 uppercase">Experience Wise Exit</p>
        <button onClick={() => navigate(to)} className="flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-700">
          Detailed Report <ArrowRight size={12} />
        </button>
      </div>
      {data.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-[13px]">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
            <Tooltip />
            <Area type="monotone" dataKey="count" stroke="#ef4444" fill="#fecaca" strokeWidth={2} />
          </AreaChart>
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

  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'short' });

  return (
    <ReportShell title="Dashboard" subtitle="Headcount snapshot as of now" loading={loading} switcherCategory="Employee Information">
      {data && (
        <div className="p-5 space-y-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <MetricCard title="Headcount & Growth Rate" metric={data.headcount} monthLabel={monthLabel} />
            <MetricCard title="Employee Addition & Growth Rate" metric={data.addition} monthLabel={monthLabel} />
            <MetricCard title="Employee Attrition & Growth Rate" metric={data.attrition} monthLabel={monthLabel} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <MiniTrend title="Employee Addition (Last 6 Months)" data={data.last6MonthsAddition} color="#10b981" to="/reports/employee/addition-trend" navigate={navigate} />
            <MiniTrend title="Employee Attrition (Last 6 Months)" data={data.last6MonthsAttrition} color="#ef4444" to="/reports/employee/attrition-trend" navigate={navigate} />
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <MiniDonut title="Designation" data={data.byDesignation} to="/reports/employee/distribution?by=designation" />
            <MiniDonut title="Department" data={data.byDepartment} to="/reports/employee/distribution?by=department" />
            <MiniDonut title="Location" data={data.byLocation} to="/reports/employee/distribution?by=location" />
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <MiniDonut title="Age" data={data.byAge} to="/reports/employee/diversity?type=age" />
            <MiniDonut title="Gender" data={data.byGender} to="/reports/employee/diversity?type=gender" />
            <MiniDonut title="Experience" data={data.byExperience} to="/reports/employee/diversity?type=experience" />
          </div>

          <div className="grid sm:grid-cols-1">
            <MiniExperienceExit data={data.experienceExit} to="/reports/employee/experience-exit" navigate={navigate} />
          </div>
        </div>
      )}
    </ReportShell>
  );
}
