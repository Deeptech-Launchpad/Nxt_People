import { useEffect, useRef } from 'react';

// Re-runs fetchFn on a fixed interval while the calling component stays
// mounted — the same pattern Topbar.jsx already uses for the notification
// bell, extracted so other "reflects someone else's action" widgets
// (Department Members, Team Attendance, Approvals) can reuse it instead of
// each hand-rolling their own setInterval.
//
// fetchFn is expected to be a *silent* refetch (no loading-spinner toggle,
// no error toast) so the background refresh never flickers the UI — the
// caller's normal mount-time fetch still owns the loading/error UX.
export default function usePolling(fetchFn, intervalMs, deps = []) {
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    const id = setInterval(() => fetchRef.current(), intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
