import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { CHART_COLORS, makeSliceLabel } from './chartLabels';

// Compact chart widget for the Dashboard — chart + "Detailed Report" link,
// no side-stats panel (that lives on the full report page).
//
// `donut` mirrors Zoho's split: the org dimensions (Designation / Department
// / Location) are drawn as solid pies, the people dimensions (Age / Gender /
// Experience) as donuts. `total` lets the caller supply a denominator that
// includes people missing the underlying field, so a slice reads the same
// percentage here as it does on the full report.
export default function MiniDonut({ title, data, to, donut = true, total }) {
  const navigate = useNavigate();
  const denom = total || (data || []).reduce((s, d) => s + Number(d.count), 0) || 1;

  return (
    <div className="border border-slate-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[15px] font-semibold text-slate-800">{title}</p>
        <button onClick={() => navigate(to)} className="flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-700">
          Detailed Report <ArrowRight size={12} />
        </button>
      </div>
      {(!data || data.length === 0) ? (
        <div className="text-center py-10 text-slate-400 text-[13px]">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          {/* Generous side margins: the slice labels sit outside the chart
              with leader lines, so the plot area has to leave room for them
              rather than letting them clip against the card edge. */}
          <PieChart margin={{ top: 12, right: 92, bottom: 12, left: 92 }}>
            <Pie
              data={data} dataKey="count" nameKey="label" cx="50%" cy="50%"
              innerRadius={donut ? 34 : 0} outerRadius={58} paddingAngle={donut ? 1 : 0}
              label={makeSliceLabel(denom, data, 250)} labelLine={false} isAnimationActive={false}
            >
              {data.map((d, i) => <Cell key={d.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value, name) => [`${value} (${((value / denom) * 100).toFixed(2)}%)`, name]} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
