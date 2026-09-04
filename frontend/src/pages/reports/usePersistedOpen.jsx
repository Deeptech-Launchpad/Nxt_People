import { useState } from 'react';

/* Whether a report's filter panel is open, remembered per page.
 *
 * A plain useState(false) here resets to closed on every remount — and
 * navigating to another page and back IS a remount, since each report page
 * is its own component instance. So opening the filter panel, going to
 * check something else, and coming straight back closed it again, every
 * time, for no reason the person watching it happen could see. It should
 * only close when the filter button is actually clicked again.
 *
 * Persists to localStorage, keyed by the page's own path, so one report's
 * panel state never leaks into another's — matching the same approach
 * EmployeeStatusFilter already uses for the same reason. Same call shape as
 * useState (returns [value, setter], setter takes a value or an updater
 * function) so it drops straight into the existing `useState(false)` call.
 */
export default function usePersistedOpen(defaultValue = false) {
  const storageKey = () => {
    try { return `nxt_filters_open:${window.location.pathname}`; } catch { return null; }
  };

  const [open, setOpenState] = useState(() => {
    try {
      const key = storageKey();
      if (!key) return defaultValue;
      const raw = localStorage.getItem(key);
      return raw === null ? defaultValue : raw === '1';
    } catch { return defaultValue; }
  });

  const setOpen = (value) => {
    setOpenState(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      try {
        const key = storageKey();
        if (key) localStorage.setItem(key, next ? '1' : '0');
      } catch { /* best-effort only — a blocked localStorage must not break the button */ }
      return next;
    });
  };

  return [open, setOpen];
}
