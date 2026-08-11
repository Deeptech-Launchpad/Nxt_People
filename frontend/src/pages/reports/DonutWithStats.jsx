import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

// Donut chart + a right-side stat panel — the shape both Diversity and
// Distribution use in Zoho, instead of a plain table.
export default function DonutWithStats({ data, stats }) {
  const total = data.reduce((s, d) => s + Number(d.count), 0) || 1;
  return (
    <div className="flex flex-col lg:flex-row items-center gap-8 p-6">
      <div className="w-full lg:flex-1 min-w-0">
        <ResponsiveContainer width="100%" height={320}>
          <PieChart>
            <Pie
              data={data} dataKey="count" nameKey="label" cx="50%" cy="50%"
              innerRadius={60} outerRadius={110} paddingAngle={1}
              label={({ percent }) => `${(percent * 100).toFixed(1)}%`}
            >
              {data.map((d, i) => <Cell key={d.label} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value, name) => [`${value} (${((value / total) * 100).toFixed(1)}%)`, name]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="w-full lg:w-64 flex-shrink-0 space-y-4">
        {stats.map(s => (
          <div key={s.label} className="border-b border-slate-100 pb-3">
            <p className="text-[13px] text-slate-500">{s.label}</p>
            <p className="text-[20px] font-bold text-slate-800 mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
