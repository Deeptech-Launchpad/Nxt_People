import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = ['#5b9bd5', '#3f3f46', '#70ad47', '#ed7d31', '#7b6bd6', '#41b8d5', '#e15759', '#a5c249'];
const RADIAN = Math.PI / 180;

// Zoho labels each slice outside the chart with a leader line, in the form
// "Saibaba Colony, Coimbatore: 94.83% (55)" — category, percentage to two
// decimals, then the raw count. Long category names wrap onto a second line
// rather than being clipped.
const makeLabel = (total) => function SliceLabel({ cx, cy, midAngle, outerRadius, name, value }) {
  const r = outerRadius + 18;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  const anchor = x > cx ? 'start' : 'end';
  const pct = ((value / total) * 100).toFixed(2);
  const label = String(name ?? '');
  // Split very long names so a single slice can't push the chart off-canvas.
  const head = label.length > 26 ? `${label.slice(0, 26)}…` : label;
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" fontSize={11} fill="#334155">
      <tspan x={x} dy="-0.4em">{head}:</tspan>
      <tspan x={x} dy="1.2em" fontWeight="600">{pct}% ({value})</tspan>
    </text>
  );
};

// Chart + right-side stat panel. `donut` picks between Zoho's two shapes:
// Distribution draws a solid pie, Diversity draws a donut.
export default function DonutWithStats({ data, stats, donut = true }) {
  const total = data.reduce((s, d) => s + Number(d.count), 0) || 1;
  return (
    <div className="flex flex-col lg:flex-row items-center gap-6 p-6">
      <div className="w-full lg:flex-1 min-w-0">
        <ResponsiveContainer width="100%" height={360}>
          <PieChart margin={{ top: 30, right: 110, bottom: 30, left: 110 }}>
            <Pie
              data={data} dataKey="count" nameKey="label" cx="50%" cy="50%"
              innerRadius={donut ? 58 : 0} outerRadius={100} paddingAngle={donut ? 1 : 0}
              label={makeLabel(total)} labelLine={{ stroke: '#cbd5e1' }} isAnimationActive={false}
            >
              {data.map((d, i) => <Cell key={d.label} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value, name) => [`${value} (${((value / total) * 100).toFixed(2)}%)`, name]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="w-full lg:w-56 flex-shrink-0 space-y-4">
        {stats.map(s => (
          <div key={s.label} className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] text-slate-500 truncate" title={s.label}>{s.label}</p>
            <p className="text-[13px] font-semibold text-slate-800 whitespace-nowrap tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
