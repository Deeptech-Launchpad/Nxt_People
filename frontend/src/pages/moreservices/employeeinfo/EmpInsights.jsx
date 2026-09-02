import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts';
import api from '../../../utils/api';

/* Operations -> Employee Information -> Insights.
 *
 * Every figure is computed at query time from the employees table. Nothing is
 * cached, because a stored headcount is wrong the moment somebody is added.
 *
 * Headcount as at a month means joined on or before it and not yet exited — so
 * the six-month trend genuinely moves. Counting `status = 'active'` would
 * repeat today's number for every month and draw a flat line that reads like
 * data but is not.
 */

// One palette, used in order, so the same category keeps the same colour
// across every chart on the page.
const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
                '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#f97316', '#64748b'];

const Card = ({ title, children, className = '' }) => (
  <div className={`bg-white border border-slate-200 rounded-xl ${className}`}>
    <div className="px-5 py-3.5 border-b border-slate-100">
      <h3 className="text-[15px] font-semibold text-slate-700">{title}</h3>
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const Growth = ({ value }) => (
  <span className={value > 0 ? 'text-emerald-600' : value < 0 ? 'text-rose-600' : 'text-slate-400'}>
    {value > 0 ? '+' : ''}{value}%
  </span>
);

function KpiCard({ title, monthLabel, current, previous, growth, year }) {
  return (
    <Card title={title}>
      <div className="grid grid-cols-3 gap-2 text-[14px]">
        <div />
        <div className="text-slate-500 text-center">Month ({monthLabel})</div>
        <div className="text-slate-500 text-center">YOY</div>

        <div className="text-slate-500">{year - 1}</div>
        <div className="text-center text-slate-700 tabular-nums">{previous}</div>
        {/* The prior year has no year before it in this response, so there is
            no growth to state. A dash says that; a 0% would be a claim. */}
        <div className="text-center text-slate-300">—</div>

        <div className="text-slate-500">{year}</div>
        <div className="text-center text-slate-800 font-semibold tabular-nums">{current}</div>
        <div className="text-center tabular-nums"><Growth value={growth} /></div>
      </div>
    </Card>
  );
}

/* The reference labels each slice with its count and share, on a leader line.
 * A donut with only a legend makes you hover every slice to read a number that
 * was already known — which is why the values looked "away from the diagram".
 * Small slices are left unlabelled rather than overlapping into illegibility;
 * they stay in the legend and the tooltip. */
const renderSliceLabel = ({ cx, cy, midAngle, outerRadius, percent, payload }) => {
  if (percent < 0.04) return null;
  const RAD = Math.PI / 180;
  const r1 = outerRadius + 12;
  const r2 = outerRadius + 26;
  const sin = Math.sin(-midAngle * RAD);
  const cos = Math.cos(-midAngle * RAD);
  const sx = cx + outerRadius * cos, sy = cy + outerRadius * sin;
  const mx = cx + r1 * cos, my = cy + r1 * sin;
  const ex = cx + r2 * cos, ey = cy + r2 * sin;
  const right = cos >= 0;
  return (
    <g>
      <polyline points={`${sx},${sy} ${mx},${my} ${ex},${ey}`} stroke="#cbd5e1" fill="none" />
      <text x={ex + (right ? 4 : -4)} y={ey} textAnchor={right ? 'start' : 'end'}
        dominantBaseline="central" fontSize={11.5} fill="#475569">
        {`${payload.count} (${payload.percent}%)`}
      </text>
    </g>
  );
};

function Donut({ data, height = 300 }) {
  if (!data.length) return <p className="text-slate-400 text-[14px] text-center py-10">No data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* Margin leaves room for the leader lines; without it they are clipped
          by the container and the numbers vanish at the edges. */}
      <PieChart margin={{ top: 8, right: 56, bottom: 8, left: 56 }}>
        <Pie data={data} dataKey="count" nameKey="label" innerRadius="48%" outerRadius="70%"
          paddingAngle={2} labelLine={false} label={renderSliceLabel} isAnimationActive={false}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v, n, p) => [`${v} (${p.payload.percent}%)`, p.payload.label]} />
        <Legend verticalAlign="bottom" height={36}
          formatter={(v, e) => <span className="text-[13px] text-slate-600">{e?.payload?.label ?? v}</span>} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export default function EmpInsights() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/employee-insights')
      .then(r => setData(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load insights'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-7 h-7 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!data) return <p className="text-center text-slate-400 py-24">No insights available.</p>;

  const monthLabel = new Date(data.asAt.year, data.asAt.month - 1, 1)
    .toLocaleDateString('en-GB', { month: 'short' });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard title="Headcount & growth rate" monthLabel={monthLabel} year={data.asAt.year}
          current={data.headcount.current} previous={data.headcount.previous} growth={data.headcount.growth} />
        <KpiCard title="Employee addition & growth rate" monthLabel={monthLabel} year={data.asAt.year}
          current={data.additions.current} previous={data.additions.previous} growth={data.additions.growth} />
        <KpiCard title="Employee attrition & growth rate" monthLabel={monthLabel} year={data.asAt.year}
          current={data.attrition.current} previous={data.attrition.previous} growth={data.attrition.growth} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Employee addition trend (Last Six Months)">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
              <YAxis yAxisId="l" tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 12, fill: '#64748b' }} unit="%" />
              <Tooltip />
              <Legend />
              <Bar yAxisId="l" dataKey="added" name="Count" fill="#5eead4" radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="addedPercent" name="Percentage" stroke="#ef4444" dot />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Employee attrition trend (Last Six Months)">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
              <YAxis yAxisId="l" tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 12, fill: '#64748b' }} unit="%" />
              <Tooltip />
              <Legend />
              <Bar yAxisId="l" dataKey="exited" name="Count" fill="#bfdbfe" radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="exitedPercent" name="Percentage" stroke="#4d7c0f" dot />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Designations (Top 10)"><Donut data={data.designations} /></Card>
        <Card title="Department (Top 10)"><Donut data={data.departments} /></Card>
        <Card title="Location (Top 10)"><Donut data={data.locations} /></Card>
        <Card title="Age"><Donut data={data.age} /></Card>
        <Card title="Gender"><Donut data={data.gender} /></Card>
        <Card title="Experience"><Donut data={data.experience} /></Card>
      </div>

      <Card title="Experience wise headcount">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.experience}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }}
              label={{ value: 'Experience', position: 'insideBottom', offset: -4, fontSize: 12, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false}
              label={{ value: 'Users Count', angle: -90, position: 'insideLeft', fontSize: 12, fill: '#64748b' }} />
            <Tooltip formatter={(v, n, p) => [`${v} (${p.payload.percent}%)`, 'Employees']} />
            <Area type="monotone" dataKey="count" stroke="#ef4444" fill="#fee2e2" />
          </AreaChart>
        </ResponsiveContainer>
        {/* The reference charts "Experience wise exit", which needs exit dates
            joined to tenure at exit. We have exit_date but almost no rows carry
            it, so a chart drawn from it would be a straight line at zero. */}
        <p className="text-[13px] text-slate-400 mt-2">
          Current headcount by tenure. Experience-wise <em>exit</em> needs exit dates, which almost
          no records carry yet — it is not built rather than drawn from nothing.
        </p>
      </Card>
    </div>
  );
}
