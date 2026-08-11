import React from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, LabelList } from 'recharts';

const growthLabel = (v) => (v === null || v === undefined ? '' : `${v}%`);

// Bar (count) + line (% growth) dual-axis chart, matching Zoho's combo
// chart for Headcount/Addition trend/Attrition trend. When the series
// crosses a calendar-year boundary (month-keyed data only), a dotted
// reference line marks where one year ends and the next begins.
export default function ComboTrendChart({ data, xKey, barColor = '#6366f1', lineColor = '#84cc16', barLabel = 'Count', lineLabel = 'Growth %' }) {
  let dividerX = null;
  for (let i = 1; i < data.length; i++) {
    if (data[i].year !== data[i - 1].year) { dividerX = data[i][xKey]; break; }
  }

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
        <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 12 }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={v => `${v}%`} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {dividerX && <ReferenceLine x={dividerX} yAxisId="left" stroke="#cbd5e1" strokeDasharray="3 3" />}
        <Bar yAxisId="left" dataKey="count" name={barLabel} fill={barColor} radius={[4, 4, 0, 0]}>
          <LabelList dataKey="count" position="top" offset={6} fontSize={11} fill="#475569" />
        </Bar>
        {/* The count and growth% labels sit on two independent y-axis
            scales, so a bar's top and a line's point can coincidentally
            land at the same pixel height. A much larger offset on the
            growth% label keeps the two from rendering on top of each
            other (garbled/overlapping text) when that happens. */}
        <Line yAxisId="right" dataKey="growth" name={lineLabel} stroke={lineColor} strokeWidth={2} dot={{ r: 3 }} connectNulls>
          <LabelList dataKey="growth" position="top" offset={20} fontSize={10} fill={lineColor} formatter={growthLabel} />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
