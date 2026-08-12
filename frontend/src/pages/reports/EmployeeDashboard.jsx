import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import MiniDonut from './MiniDonut';

// Zoho renders each figure as "67 | -8.22%": count, a pipe, then the rate to
// two decimals, all in the same weight — no +/- colouring. A zero count is
// shown as 0.00%, not -100%: "nobody joined this month" is a rate of zero,
// not a 100% collapse, and the delta form made empty months look alarming.
function cellText(cell) {
  if (!cell) return '—';
  const count = cell.value ?? 0;
  const g = cell.growth;
  if (g === null || g === undefined) return `${count}`;
  const pct = count === 0 ? 0 : g;
  return `${count} | ${Number(pct).toFixed(2)}%`;
}

// 2-row x 2-col (Month(<current month>) / YoY) table, oldest year first —
// matching Zoho's stat widget.
function MetricCard({ title, metric, monthLabel }) {
  const rows = [
    { label: metric.lastYear.year, month: metric.lastYear.month, yoy: metric.lastYear.yoy },
    { label: metric.thisYear.year, month: metric.thisYear.month, yoy: metric.thisYear.yoy },
  ];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-[15px] font-semibold text-slate-800 text-center mb-4">{title}</p>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left font-normal pb-2"></th>
            <th className="text-right font-normal pb-2">Month ({monthLabel})</th>
            <th className="text-right font-normal pb-2">YOY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.label}>
              <td className="py-1.5 text-slate-600">{row.label}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-700">{cellText(row.month)}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-700">{cellText(row.yoy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniTrend({ title, data, color, lineColor, to, navigate }) {
  return (
    <div className="border border-slate-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[15px] font-semibold text-slate-800">{title}</p>
        <button onClick={() => navigate(to)} className="flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-700">
          Detailed Report <ArrowRight size={12} />
        </button>
      </div>
      {data.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-[13px]">No data in the last 6 months</div>
      ) : (
        <ComboTrendChart data={data} xKey="month" barColor={color} lineColor={lineColor} lineLabel="Percentage" />
      )}
    </div>
  );
}

function MiniExperienceExit({ data, to, navigate }) {
  return (
    <div className="border border-slate-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[15px] font-semibold text-slate-800">Experience wise exit</p>
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
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} label={{ value: "Users Count", angle: -90, position: "insideLeft", offset: 12, fontSize: 11 }} />
            <Tooltip />
            <Area type="linear" dataKey="count" stroke="#ef4444" fill="#fecaca" strokeWidth={2} />
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
            <MetricCard title="Headcount & growth rate" metric={data.headcount} monthLabel={monthLabel} />
            <MetricCard title="Employee addition & growth rate" metric={data.addition} monthLabel={monthLabel} />
            <MetricCard title="Employee attrition & growth rate" metric={data.attrition} monthLabel={monthLabel} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <MiniTrend title="Employee addition trend (Last Six Months)" data={data.last6MonthsAddition} color="#a7e8d0" lineColor="#e15759" to="/reports/employee/addition-trend" navigate={navigate} />
            <MiniTrend title="Employee attrition trend (Last Six Months)" data={data.last6MonthsAttrition} color="#a8c8ec" lineColor="#6b8e23" to="/reports/employee/attrition-trend" navigate={navigate} />
          </div>

          {/* Zoho draws the org dimensions as solid pies and the people
              dimensions as donuts. Age and Experience pass the full headcount
              as the denominator because their buckets exclude anyone missing
              a date of birth / joining date. */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <MiniDonut title="Designations (Top 10)" data={data.byDesignation} donut={false} total={data.totalActive} to="/reports/employee/distribution?by=designation" />
            <MiniDonut title="Department (Top 10)" data={data.byDepartment} donut={false} total={data.totalActive} to="/reports/employee/distribution?by=department" />
            <MiniDonut title="Location (Top 10)" data={data.byLocation} donut={false} total={data.totalActive} to="/reports/employee/distribution?by=location" />
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <MiniDonut title="Age" data={data.byAge} total={data.totalActive} to="/reports/employee/diversity?type=age" />
            <MiniDonut title="Gender" data={data.byGender} total={data.totalActive} to="/reports/employee/diversity?type=gender" />
            <MiniDonut title="Experience" data={data.byExperience} total={data.totalActive} to="/reports/employee/diversity?type=experience" />
          </div>

          <div className="grid sm:grid-cols-1">
            <MiniExperienceExit data={data.experienceExit} to="/reports/employee/experience-exit" navigate={navigate} />
          </div>
        </div>
      )}
    </ReportShell>
  );
}
