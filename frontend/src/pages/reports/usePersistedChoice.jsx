import { useState } from 'react';

/* A report's one-of-several toggle, remembered per page.
 *
 * The string-valued sibling of usePersistedOpen, and it exists for exactly
 * the same reason: each report page is its own component instance, so
 * navigating away and back is a remount and a plain useState resets the
 * choice. Picking Day on the Present/Absent grid, going to check something
 * else and coming back put you on Hour again — the default reasserting
 * itself over a choice the person had just made.
 *
 * A stored value outside `allowed` falls back to the default rather than
 * being handed to the caller: the key is a string in localStorage and
 * anything could be in there, and a grid asked to render a mode it has no
 * branch for renders nothing at all.
 *
 * Keyed by the page's own path so one report's choice never leaks into
 * another's, plus a name so a page can persist more than one.
 */
export default function usePersistedChoice(name, defaultValue, allowed) {
  const storageKey = () => {
    try { return `nxt_choice:${name}:${window.location.pathname}`; } catch { return null; }
  };

  const [value, setValueState] = useState(() => {
    try {
      const key = storageKey();
      if (!key) return defaultValue;
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return (!allowed || allowed.includes(raw)) ? raw : defaultValue;
    } catch { return defaultValue; }
  });

  const setValue = (next) => {
    setValueState(prev => {
      const v = typeof next === 'function' ? next(prev) : next;
      try {
        const key = storageKey();
        if (key) localStorage.setItem(key, String(v));
      } catch { /* best-effort only — a blocked localStorage must not break the toggle */ }
      return v;
    });
  };

  return [value, setValue];
}
