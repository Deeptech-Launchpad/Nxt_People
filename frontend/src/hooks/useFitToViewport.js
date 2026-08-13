import { useState, useLayoutEffect } from 'react';

// Layout's Help / Take a Tour strip is fixed to the bottom of the window, so a
// scroll region has to stop short of it rather than run underneath.
const BOTTOM_BAR = 30;
const MIN_HEIGHT = 220;

// Gives a scroll container exactly the height left between where it starts and
// the foot of the window.
//
// The alternative — a "100vh minus 300px" guess — is only ever right on one
// window: it strands a report's horizontal scrollbar and any footer below the
// fold on a tall table, and clips them on a short one. It also can't see the
// filter panel opening above it.
//
// `ref` is the scroll container. `footerRef` is an optional element that sits
// directly beneath it inside the same panel (a legend strip, say) and must stay
// visible. `deps` are whatever changes the container's position or contents.
export default function useFitToViewport(ref, footerRef, deps = []) {
  const [height, setHeight] = useState(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (!ref.current) return;
      const top = ref.current.getBoundingClientRect().top;
      // Read the page's own bottom padding rather than hardcoding it —
      // guessing leaves the page scrollable by the difference, which slides
      // whatever is underneath back under the fixed bar.
      const shell = ref.current.closest('.report-shell');
      const pagePad = shell ? parseFloat(getComputedStyle(shell).paddingBottom) || 0 : 0;
      const reserve = (footerRef?.current?.offsetHeight || 0) + BOTTOM_BAR + pagePad;
      setHeight(Math.max(MIN_HEIGHT, window.innerHeight - top - reserve));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return height;
}
