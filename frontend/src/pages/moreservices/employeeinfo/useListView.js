import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';

/* Everything a list tab needs to talk to the shared engine: paging, sorting,
 * criteria, the saved view, and the per-person hidden columns.
 *
 * Kept in one hook because the three tabs would otherwise each re-derive the
 * same query-string assembly, and that is exactly where "the filter is set but
 * nothing happened" bugs come from — one of them forgets to send a parameter
 * and the screen looks like it answered.
 */
export default function useListView({ endpoint, module, defaultSort }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState(defaultSort || { by: '', dir: 'desc' });
  const [criteria, setCriteria] = useState([]);
  const [system, setSystem] = useState({});
  const [scope, setScope] = useState('all');
  const [fields, setFields] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [view, setView] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!module) return;
    api.get(`/saved-views/column-prefs/${module}`)
      .then(r => setHidden(r.data.data?.hidden || []))
      .catch(() => {});
  }, [module]);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (sort.by) { q.set('sortBy', sort.by); q.set('sortDir', sort.dir); }
    if (criteria.length) q.set('criteria', JSON.stringify(criteria));
    if (scope && scope !== 'all') q.set('scope', scope);
    for (const [k, v] of Object.entries(system)) if (v) q.set(k, v);

    api.get(`${endpoint}?${q}`)
      .then(r => {
        setRows(r.data.data || []);
        setTotal(r.data.total ?? (r.data.data || []).length);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load that list'))
      .finally(() => setLoading(false));
  }, [endpoint, page, limit, sort, criteria, scope, system, reloadKey]);

  useEffect(() => { load(); }, [load]);

  /* Anything that changes WHICH rows match has to reset to page 1, or you land
   * on a page that no longer exists and the table reads as empty. */
  const applyCriteria = (next, nextSystem) => {
    setPage(1);
    setCriteria(next);
    if (nextSystem !== undefined) setSystem(nextSystem);
  };
  const changeSort = (key) => {
    setPage(1);
    setSort(s => (s.by === key ? { by: key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by: key, dir: 'asc' }));
  };
  const changeScope = (s) => { setPage(1); setScope(s); };
  const changeLimit = (n) => { setPage(1); setLimit(n); };

  const saveHidden = (next) => {
    setHidden(next);
    api.put(`/saved-views/column-prefs/${module}`, { hidden: next })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save your columns'));
  };

  /* Picking a saved view applies its criteria; its column list becomes the
   * visible set, expressed as the inverse (what to hide) so it plugs into the
   * same mechanism the column picker uses. */
  const selectView = (v, allKeys) => {
    setView(v);
    setPage(1);
    setCriteria(v?.criteria || []);
    if (v?.columns?.length && allKeys) setHidden(allKeys.filter(k => !v.columns.includes(k)));
    else if (!v) setHidden([]);
  };

  return {
    rows, total, loading, page, limit, sort, criteria, scope, fields, hidden, view, system,
    setFields, setPage, setLimit: changeLimit, onSort: changeSort,
    onCriteria: applyCriteria, onScope: changeScope, onHidden: saveHidden, onView: selectView,
    reload: () => setReloadKey(k => k + 1),
  };
}
