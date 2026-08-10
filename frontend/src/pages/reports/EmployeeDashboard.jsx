import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import MiniDonut from './MiniDonut';

const now = new Date();
const thisMonthLabel = now.toLocaleDateString('en-US', { month: 'short' });

function growthText(v) {
  if (v === null || v === undefined) return '—';
  return `${v > 0 ? '+' : ''}${v}%`;
}
function growthColor(v) {
  if (v === null || v === undefined) return 'text-slate-400';
  return v >= 0 ? 'text-emerald-600' : 'text-red-600';
}

// This Month / Year-on-Year comparison card — same two figures Zoho shows
// per metric (a month reading and a YoY reading), each with its own growth
// %, collapsed into one row instead of a multi-year table.
function MetricCard({ title, metric }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-[13px] font-bold text-slate-500 uppercase mb-3">{title}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[12px] text-slate-400">This Month ({thisMonthLabel})</p>
          <p className="text-[22px] font-bold text-slate-800">{metric.thisMonth}</p>
          <p className={`text-[12px] font-semibold ${growthColor(metric.momGrowth)}`}>{growthText(metric.momGrowth)} MoM</p>
        </div>
        <div>
          <p className="text-[12px] text-slate-400">Year-on-Year</p>
          <p className="text-[22px] font-bold text-slate-800">{metric.yoy}</p>
          <p className={`text-[12px] font-semibold ${growthColor(metric.yoyGrowth)}`}>{growthText(metric.yoyGrowth)} YoY</p>
        </div>
      </div>
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
        <ComboTrendChart data={data} xKey="month" barColor={color} />
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

  return (
    <ReportShell title="Dashboard" subtitle="Headcount snapshot as of now" loading={loading} switcherCategory="Employee Information">
      {data && (
        <div className="p-5 space-y-6">
          <div className="grid sm:grid-cols-3 gap-4">
            <MetricCard title="Headcount & Growth Rate" metric={data.headcount} />
            <MetricCard title="Employee Addition & Growth Rate" metric={data.addition} />
            <MetricCard title="Employee Attrition & Growth Rate" metric={data.attrition} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <MiniTrend title="Employee Addition (Last 6 Months)" data={data.last6MonthsAddition} color="#10b981" to="/reports/employee/addition-trend" navigate={navigate} />
            <MiniTrend title="Employee Attrition (Last 6 Months)" data={data.last6MonthsAttrition} color="#ef4444" to="/reports/employee/attrition-trend" navigate={navigate} />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MiniDonut title="Department" data={data.byDepartment} to="/reports/employee/distribution?by=department" />
            <MiniDonut title="Gender" data={data.byGender} to="/reports/employee/diversity?type=gender" />
            <MiniDonut title="Age" data={data.byAge} to="/reports/employee/diversity?type=age" />
            <MiniDonut title="Experience" data={data.byExperience} to="/reports/employee/diversity?type=experience" />
          </div>
        </div>
      )}
    </ReportShell>
  );
}
