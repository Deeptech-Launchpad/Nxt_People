import React from 'react';

// Zoho's chart palette: a muted blue lead, charcoal, green, orange, violet,
// cyan, red, lime — distinct enough that adjacent thin slices stay separable.
export const CHART_COLORS = [
  '#5b9bd5', '#3f3f46', '#70ad47', '#ed7d31', '#7b6bd6',
  '#41b8d5', '#e15759', '#a5c249', '#c86fc9', '#8c8c8c',
];

const RADIAN = Math.PI / 180;

// Zoho labels each slice outside the chart with a leader line, reading
// "Content: 60.34% (35)" — name, percentage to two decimals, then the raw
// count. Two behaviours matter for legibility on crowded pies:
//
//  - `denom` is passed in rather than summed from the slices, so charts whose
//    buckets exclude people with a missing field (age, tenure) still divide
//    by the real headcount and agree with the stat panel beside them.
//  - Thin slices are pushed progressively further out. Without this, a run of
//    1.72% slices all resolve to nearly the same angle and their labels stack
//    on top of each other into an unreadable block, which is exactly what the
//    Department and Designation pies were doing.
export function makeSliceLabel(denom, baseOffset = 22) {
  return function SliceLabel({ cx, cy, midAngle, outerRadius, name, value, index }) {
    const share = value / (denom || 1);
    // Slices under ~4% get a staircase of extra radius, alternating depth so
    // neighbours in a crowded run never land on the same ring.
    const crowded = share < 0.04;
    const stagger = crowded ? (index % 3) * 16 : 0;
    const r = outerRadius + baseOffset + stagger;

    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    const anchor = x > cx ? 'start' : 'end';

    const label = String(name ?? '');
    const head = label.length > 24 ? `${label.slice(0, 24)}…` : label;
    const pct = (share * 100).toFixed(2);

    return (
      <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" fontSize={11} fill="#334155">
        <tspan x={x} dy="-0.4em">{head}:</tspan>
        <tspan x={x} dy="1.15em" fontWeight="600">{pct}% ({value})</tspan>
      </text>
    );
  };
}
