import { useEffect, useState } from 'react';

/* Drag feedback is the one thing on this page that moves on its own, so it is
 * also the one thing worth switching off for somebody who has asked the OS for
 * less motion. The repo has no motion-reduce: variants to lean on, so the query
 * is read here and the transition classes are simply not emitted. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = e => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Move `dragKey` to sit before or after `targetKey`.
 *
 * Always applied to the FULL key order, never to the visible subset: dropping
 * one card onto another has to decide where the dragged card lands among the
 * hidden ones too, or unhiding a widget later would put it somewhere nobody
 * chose.
 */
export function insertKey(order, dragKey, targetKey, position) {
  if (!dragKey || dragKey === targetKey) return order;
  const without = order.filter(k => k !== dragKey);
  let idx = without.indexOf(targetKey);
  if (idx === -1) return order;
  if (position === 'after') idx += 1;
  without.splice(idx, 0, dragKey);
  return without;
}

/** Which side of the element the pointer is on. */
export function dropSide(e, axis) {
  const r = e.currentTarget.getBoundingClientRect();
  return axis === 'y'
    ? (e.clientY < r.top + r.height / 2 ? 'before' : 'after')
    : (e.clientX < r.left + r.width / 2 ? 'before' : 'after');
}
