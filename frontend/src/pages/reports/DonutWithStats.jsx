import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { CHART_COLORS, makeSliceLabel } from './chartLabels';

// Chart + right-side stat panel. `donut` picks between Zoho's two shapes:
// Distribution draws a solid pie, Diversity draws a donut. `total` overrides
// the percentage denominator — Age and Experience bucket only the people who
// have a date of birth / joining date, but Zoho still divides by the full
// headcount, so 18 of 58 reads 31.03% rather than 31.58% of the 57 bucketed.
export default function DonutWithStats({ data, stats, donut = true, total }) {
  const denom = total || data.reduce((s, d) => s + Number(d.count), 0) || 1;
  return (
    <div className="flex flex-col lg:flex-row items-center gap-6 p-6">
      <div className="w-full lg:flex-1 min-w-0">
        <ResponsiveContainer width="100%" height={420}>
          <PieChart margin={{ top: 40, right: 150, bottom: 40, left: 150 }}>
            <Pie
              data={data} dataKey="count" nameKey="label" cx="50%" cy="50%"
              innerRadius={donut ? 62 : 0} outerRadius={108} paddingAngle={donut ? 1 : 0}
              label={makeSliceLabel(denom)} labelLine={{ stroke: '#cbd5e1' }} isAnimationActive={false}
            >
              {data.map((d, i) => <Cell key={d.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value, name) => [`${value} (${((value / denom) * 100).toFixed(2)}%)`, name]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="w-full lg:w-60 flex-shrink-0 space-y-4">
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
