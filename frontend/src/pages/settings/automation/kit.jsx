import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';

// Shared by the Automation screens. The Form filter, the merge-field inserter
// and the log timeline all appear on more than one of them, and three copies
// of a filter is three places for it to start behaving differently.

export const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';
export const select = `${input} bg-white`;

/** The catalogue every Automation screen is drawn from, fetched once. */
export function useCatalog() {
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    api.get('/workflows/catalog')
      .then(r => setCatalog(r.data.data))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setCatalog({ recordTypes: [] }); });
  }, []);
  return catalog;
}

/** A list scoped by record type, with the reference's Form dropdown. */
export function useScopedList(path) {
  const [scope, setScope] = useState('all');
  const [rows, setRows] = useState(null);

  const load = useCallback(() => (
    api.get(`${path}?recordType=${scope}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setRows([]); })
  ), [path, scope]);

  useEffect(() => { load(); }, [load]);
  return { scope, setScope, rows, reload: load };
}

// The reference labels this "Form". Ours are record types, so the word stays
// but the list is what we actually have.
export function FormFilter({ recordTypes, value, onChange, label = 'Form' }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[14px] text-slate-600">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className={`${select} min-w-[220px]`}>
        <option value="all">All</option>
        {recordTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
    </div>
  );
}

export function Field({ label, required, hint, children, wide }) {
  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[12.5px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

/**
 * The reference's merge-field inserter above the message body. Puts
 * `${fieldName}` at the cursor — the same syntax automationConfig.render()
 * substitutes, so what is inserted is what gets replaced.
 */
export function MergeFields({ fields, onInsert }) {
  const [pick, setPick] = useState('');
  if (!fields?.length) return null;
  return (
    <div className="flex items-end gap-2 flex-wrap mb-2">
      <div>
        <label className="block text-[12.5px] text-slate-500 mb-1">Available merge fields</label>
        <select value={pick} onChange={e => setPick(e.target.value)} className={`${select} min-w-[200px]`}>
          <option value="">Select</option>
          {fields.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <button
        type="button" disabled={!pick}
        onClick={() => { onInsert(`\${${pick}}`); setPick(''); }}
        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-[13.5px] font-medium"
      >
        Insert
      </button>
      <span className="text-[12.5px] text-slate-500 pb-2.5">
        An unknown field is left as written rather than becoming "undefined".
      </span>
    </div>
  );
}

const STATUS_STYLE = {
  success: 'text-emerald-600',
  failed: 'text-red-600',
  skipped: 'text-slate-500',
};

/** The reference groups its logs by day under a year heading. */
export function LogTimeline({ rows, columns, emptyText }) {
  if (!rows.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-14 text-center">
        <p className="text-[14px] text-slate-600">{emptyText}</p>
      </div>
    );
  }

  const groups = [];
  for (const row of rows) {
    const d = new Date(row.executedAt);
    const day = d.toLocaleDateString('en-GB');
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, year: d.getFullYear(), rows: [] });
    groups[groups.length - 1].rows.push(row);
  }

  return (
    <div className="space-y-6">
      {groups.map((g, i) => (
        <div key={g.day}>
          {(i === 0 || groups[i - 1].year !== g.year) && (
            <p className="text-[16px] font-semibold text-slate-800 mb-2">{g.year}</p>
          )}
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
            <p className="text-[13.5px] text-slate-600">{g.day}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden ml-4">
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead className="bg-slate-50">
                  <tr>
                    {columns.map(c => (
                      <th key={c.key} className="text-left font-medium text-slate-600 px-6 py-2.5 whitespace-nowrap">{c.label}</th>
                    ))}
                    <th className="text-left font-medium text-slate-600 px-6 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map(row => (
                    <tr key={row.id} className="border-t border-slate-100">
                      {columns.map(c => (
                        <td key={c.key} className="px-6 py-3 text-slate-700 align-top">
                          {c.render ? (c.render(row) || <span className="text-slate-400">—</span>)
                            : (row[c.key] || <span className="text-slate-400">—</span>)}
                        </td>
                      ))}
                      <td className="px-6 py-3 align-top">
                        <span className={STATUS_STYLE[row.status] || 'text-slate-600'}>
                          {row.status === 'success' ? 'Successful' : row.status === 'failed' ? 'Failed' : 'Skipped'}
                        </span>
                        {/* The reference puts an info dot here; the message is
                            the whole reason a skipped row is not a mystery. */}
                        {row.message && (
                          <span className="block text-[12.5px] text-slate-500 mt-0.5 max-w-md">{row.message}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
