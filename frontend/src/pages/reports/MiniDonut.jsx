import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

// Compact donut widget for the Dashboard — chart + "Detailed Report" link,
// no side-stats panel (that lives on the full report page).
export default function MiniDonut({ title, data, to }) {
  const navigate = useNavigate();
  return (
    <div className="border border-slate-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-bold text-slate-500 uppercase">{title}</p>
        <button onClick={() => navigate(to)} className="flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-700">
          Detailed Report <ArrowRight size={12} />
        </button>
      </div>
      {(!data || data.length === 0) ? (
        <div className="text-center py-10 text-slate-400 text-[13px]">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          {/* recharts' default Pie startAngle puts the first (often
              largest) slice's midpoint right at 12 o'clock, so its label
              needs headroom above the chart or it clips/overlaps the
              card's top edge — hence the top margin and slightly smaller
              radius versus the chart's own height. */}
          <PieChart margin={{ top: 18, right: 4, bottom: 4, left: 4 }}>
            <Pie data={data} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={42} outerRadius={74} paddingAngle={1} label={({ percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
              {data.map((d, i) => <Cell key={d.label} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value, name) => [value, name]} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
