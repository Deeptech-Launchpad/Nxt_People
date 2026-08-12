import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, LabelList } from 'recharts';

const growthLabel = (v) => (v === null || v === undefined ? '' : `${v}%`);

// Bar (count) + line (% growth) dual-axis chart, matching Zoho's combo
// chart for Headcount/Addition trend/Attrition trend. When the series
// crosses a calendar-year boundary (month-keyed data only), a dotted
// reference line marks where one year ends and the next begins.
//
// Labels are hidden when the container is narrow (< 600px) to prevent
// text overlap — the tooltip still shows all values on hover.
export default function ComboTrendChart({ data, xKey, barColor = '#6366f1', lineColor = '#65a30d', barLabel = 'Count', lineLabel = 'Growth %' }) {
  const wrapRef = useRef(null);
  const [wide, setWide] = useState(true);

  // Zoho labels every point even on its small dashboard widgets, so the
  // threshold is set to the narrowest the dashboard's two-up grid gets rather
  // than 600px — at 600 the mini trends fell just under it and rendered with
  // no labels at all, which is the most useful part of the chart.
  const measure = useCallback(() => {
    if (wrapRef.current) setWide(wrapRef.current.offsetWidth >= 340);
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [measure]);

  // Zoho marks the calendar-year boundary with a dotted rule labelled with
  // the year on each side, so a 12-month window spanning Dec→Jan reads
  // unambiguously.
  let dividerX = null;
  let dividerYears = null;
  for (let i = 1; i < data.length; i++) {
    if (data[i].year !== data[i - 1].year) {
      dividerX = data[i][xKey];
      dividerYears = { prev: data[i - 1].year, next: data[i].year };
      break;
    }
  }

  return (
    <div ref={wrapRef}>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey={xKey} tick={{ fontSize: wide ? 12 : 10 }} interval={wide ? 0 : 'preserveStartEnd'} />
          <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 12 }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={v => `${v}%`} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {dividerX && (
            <ReferenceLine
              x={dividerX} yAxisId="left" stroke="#64748b" strokeDasharray="3 3"
              label={wide && dividerYears
                ? { value: `${dividerYears.prev}  |  ${dividerYears.next}`, position: 'top', fontSize: 11, fill: '#475569' }
                : undefined}
            />
          )}
          <Bar yAxisId="left" dataKey="count" name={barLabel} fill={barColor} radius={[4, 4, 0, 0]}>
            {wide && <LabelList dataKey="count" position="top" offset={6} fontSize={11} fill="#475569" />}
          </Bar>
          {/* The count and growth% labels sit on two independent y-axis
              scales, so a bar's top and a line's point can coincidentally
              land at the same pixel height. A much larger offset on the
              growth% label keeps the two from rendering on top of each
              other (garbled/overlapping text) when that happens. */}
          <Line yAxisId="right" dataKey="growth" name={lineLabel} stroke={lineColor} strokeWidth={2} dot={{ r: 3 }} connectNulls>
            {wide && <LabelList dataKey="growth" position="top" offset={28} fontSize={10} fill={lineColor} formatter={growthLabel} />}
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
