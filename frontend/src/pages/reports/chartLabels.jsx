import React from 'react';
import { Sector } from 'recharts';

// Hover feedback has to follow the mark's own geometry. Recharts' default
// tooltip cursor is a rectangle — on a pie it drew a box across whatever
// slice you were over, which reads as a selection of the wrong region.
// Pass `cursor={false}` to <Tooltip> and this as the Pie's `activeShape`:
// the hovered sector grows a little along its own arc instead.
export function ActiveSlice({ cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill }) {
  return (
    <Sector
      cx={cx} cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 6}
      startAngle={startAngle} endAngle={endAngle}
      fill={fill}
    />
  );
}

// Zoho's chart palette: a muted blue lead, charcoal, green, orange, violet,
// cyan, red, lime — distinct enough that adjacent thin slices stay separable.
export const CHART_COLORS = [
  '#5b9bd5', '#3f3f46', '#70ad47', '#ed7d31', '#7b6bd6',
  '#41b8d5', '#e15759', '#a5c249', '#c86fc9', '#8c8c8c',
];

const RADIAN = Math.PI / 180;

// Assign every slice a collision-free vertical slot.
//
// Placing each label at its own slice's angle is what made the Department and
// Designation pies unreadable: a run of 1.72% slices spans barely a degree
// each, so their labels all resolved to nearly the same y and printed on top
// of one another. Instead, labels on each side of the pie are ordered by
// angle and then spread evenly down that side, with a leader line bending
// from the slice edge across to the label. Geometry here mirrors recharts'
// own default sweep (startAngle 0 → endAngle 360, angles counter-clockwise
// from 3 o'clock) so a slot lines up with the slice it belongs to.
function computeLabelSlots(data) {
  const total = data.reduce((s, d) => s + Number(d.count), 0) || 1;
  let acc = 0;
  const items = data.map((d, i) => {
    const startFrac = acc / total;
    acc += Number(d.count);
    const midAngle = 360 * ((startFrac + acc / total) / 2);
    return {
      i,
      dy: Math.sin(-midAngle * RADIAN),          // negative = above centre
      right: Math.cos(-midAngle * RADIAN) >= 0,
    };
  });

  const slots = new Array(items.length);
  [true, false].forEach(isRight => {
    const side = items.filter(it => it.right === isRight).sort((a, b) => a.dy - b.dy);
    side.forEach((it, rank) => { slots[it.i] = { right: isRight, rank, count: side.length }; });
  });
  return slots;
}

// Renders "Content: 60.34% (35)" outside the pie with its own leader line.
// Callers must set `labelLine={false}` — the line is drawn here so it tracks
// the de-collided label position rather than recharts' original one.
//
// `denom` is passed in rather than summed from the slices so charts whose
// buckets exclude people with a missing field (age, tenure) still divide by
// the real headcount and agree with the stat panel beside them.
// `labelText` swaps the default two-line "Name:" / "12.34% (56)" for a
// caller-supplied single line — Daily Leave Status labels its slices
// "Casual Leave,1", with no percentage at all.
export function makeSliceLabel(denom, data, chartHeight = 360, labelText = null) {
  const slots = computeLabelSlots(data);

  return function SliceLabel({ cx, cy, midAngle, outerRadius, name, value, index }) {
    const slot = slots[index] || { right: true, rank: 0, count: 1 };
    const dir = slot.right ? 1 : -1;

    // Share the available height between the labels on this side; drop to a
    // single tighter line when a crowded side can't afford two.
    const usable = Math.max(chartHeight - 16, 60);
    const gap = Math.min(30, usable / Math.max(slot.count, 1));
    const compact = gap < 26;
    const y = cy + (slot.rank - (slot.count - 1) / 2) * gap;

    const edge = outerRadius + 2;
    const x0 = cx + edge * Math.cos(-midAngle * RADIAN);
    const y0 = cy + edge * Math.sin(-midAngle * RADIAN);
    const elbowX = cx + dir * (outerRadius + 20);
    const textX = cx + dir * (outerRadius + 28);

    const label = String(name ?? '');
    const maxChars = compact ? 20 : 26;
    const head = label.length > maxChars ? `${label.slice(0, maxChars)}…` : label;
    const pct = ((value / (denom || 1)) * 100).toFixed(2);
    const anchorX = textX + dir * 4;

    return (
      <g>
        <polyline
          points={`${x0},${y0} ${elbowX},${y} ${textX},${y}`}
          stroke="#cbd5e1" strokeWidth={1} fill="none"
        />
        <text
          x={anchorX} y={y} textAnchor={slot.right ? 'start' : 'end'}
          dominantBaseline="central" fontSize={compact ? 10 : 11} fill="#334155"
        >
          {labelText ? (
            <tspan>{labelText(head, value, pct)}</tspan>
          ) : compact ? (
            <tspan>{head}: {pct}% ({value})</tspan>
          ) : (
            <>
              <tspan x={anchorX} dy="-0.4em">{head}:</tspan>
              <tspan x={anchorX} dy="1.15em" fontWeight="600">{pct}% ({value})</tspan>
            </>
          )}
        </text>
      </g>
    );
  };
}
