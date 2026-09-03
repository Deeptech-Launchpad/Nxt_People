import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Trash2, Plus, X, ArrowLeft, Search, ChevronDown } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';

// Locations, Departments, Designations, Companies, Business Units and Divisions
// are the same screen with different fields: a list with a count of who is on
// it, an Add button, and an editor. One component rather than six, so the
// delete guard and the error handling cannot drift between them.
//
// `fields` describes the editor; `columns` describes the table.
//
// Two editor shapes, because the reference uses two. The Organization Setup
// lists open a full page — the list is replaced, the form has Submit, Submit
// and New, and Cancel. The Organization Structure lists open a right-hand
// slide-over instead, which is a smaller form over the list it came from.
// `variant` picks between them; everything else is shared.

const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

// A picker that filters as you type. The reference's Department Lead shows the
// name and the employee id together — two people can share a name, and the id
// is the only thing that tells them apart.
function SearchSelect({ value, options, placeholder, onChange, onAdd }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const chosen = options.find(o => o.value === value);
  const shown = term.trim()
    ? options.filter(o => `${o.label} ${o.sub || ''}`.toLowerCase().includes(term.trim().toLowerCase()))
    : options;

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 min-w-0" ref={box}>
        <button
          type="button"
          onClick={() => { setOpen(o => !o); setTerm(''); }}
          className={`${input} bg-white flex items-center justify-between gap-2 text-left`}
        >
          <span className={chosen ? 'truncate' : 'truncate text-slate-400'}>
            {chosen ? chosen.label : (placeholder || 'None')}
            {chosen?.sub && <span className="text-slate-400 ml-1.5">{chosen.sub}</span>}
          </span>
          <ChevronDown size={15} className="text-slate-400 flex-shrink-0" />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
              <Search size={14} className="text-slate-400" />
              <input
                autoFocus value={term} onChange={e => setTerm(e.target.value)}
                placeholder="Search"
                className="w-full text-[13.5px] outline-none"
              />
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-[13.5px] text-slate-500 hover:bg-slate-50"
              >
                {placeholder || 'None'}
              </button>
              {shown.length === 0 && (
                <p className="px-3 py-3 text-[13px] text-slate-500">No matches.</p>
              )}
              {shown.map(o => (
                <button
                  key={o.value} type="button"
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-[13.5px] hover:bg-slate-50 flex items-center gap-2 ${
                    o.value === value ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.sub && <span className="text-slate-400 text-[12.5px] flex-shrink-0">{o.sub}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {onAdd && (
        <button
          type="button" onClick={onAdd} aria-label="Add new"
          className="flex-shrink-0 w-9 h-9 grid place-items-center border border-slate-300 rounded-md text-slate-500 hover:text-blue-600 hover:border-blue-400"
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}

function Field({ f, value, rows, excludeId, record, onChange, onQuickAdd }) {
  // A record cannot be its own parent, so it is not offered. This is separate
  // from the server's ancestry guard: that catches a cycle two levels deep,
  // this stops the one-level case ever being on screen.
  const options = useMemo(
    () => (f.options ? (f.options(rows) || []).filter(o => !(f.selfExcluding && o.value === excludeId)) : []),
    [f, rows, excludeId]
  );

  /* A field the caller draws itself. Locations needs one: a geofence is a
   * point, a radius and a way to stand outside and test it — four inputs that
   * only make sense together, and none of them a labelled text box. */
  if (f.type === 'custom') {
    return (
      <div className={f.wide ? 'md:col-span-2' : ''}>
        {f.render({ record, set: onChange })}
      </div>
    );
  }

  return (
    <div className={f.wide ? 'md:col-span-2' : ''}>
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
        {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      {f.type === 'select' || f.type === 'search-select' ? (
        <SearchSelect
          value={value || null}
          options={options}
          placeholder={f.placeholder}
          onChange={v => onChange(f.key, v)}
          onAdd={f.quickAdd ? () => onQuickAdd(f) : null}
        />
      ) : f.type === 'textarea' ? (
        <textarea
          rows={3} value={value || ''} maxLength={f.maxLength}
          onChange={e => onChange(f.key, e.target.value)}
          className={input}
        />
      ) : (
        <input
          value={value || ''} placeholder={f.placeholder} maxLength={f.maxLength}
          onChange={e => onChange(f.key, e.target.value)}
          className={f.readOnly ? `${input} bg-slate-100 text-slate-500` : input}
          readOnly={f.readOnly}
        />
      )}

      {f.hint && <p className="text-[12.5px] text-slate-500 mt-1">{f.hint}</p>}
    </div>
  );
}

export default function RecordList({
  resource, title, description, singular, columns, fields, emptyHint,
  variant = 'page', usersLabel = 'Associated users', onExternalAdd,
}) {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);   // a row, or {} for a new one
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState(null);         // { row, list }

  const load = useCallback(() => (
    api.get(`/org-setup/${resource}`)
      .then(r => { setRows(r.data.data || []); return r.data.data || []; })
      .catch(err => {
        toast.error(err.response?.data?.message || `Failed to load ${title.toLowerCase()}`);
        setRows([]);
        return [];
      })
  ), [resource, title]);

  useEffect(() => { load(); }, [load]);

  const set = (key, value) => setEditing(v => ({ ...v, [key]: value }));

  // A field can create its own options — the reference puts a + beside Parent
  // Department. Whatever it creates is selected straight away, because
  // creating one and then having to find it in the list is the reason people
  // create duplicates.
  const quickAdd = async f => {
    const name = window.prompt(`New ${f.label.toLowerCase()}`);
    if (!name || !name.trim()) return;
    try {
      const r = await api.post(`/org-setup/${f.quickAdd}`, { name: name.trim() });
      toast.success(`${name.trim()} added`);
      // The list this screen owns reloads itself; anything else it borrows —
      // the company list on a business unit, say — is the screen's to refetch,
      // and without that the new row is selected by an id with no label.
      if (f.quickAdd === resource) await load();
      else if (onExternalAdd) await onExternalAdd(f.quickAdd);
      set(f.key, r.data.data.id);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add');
    }
  };

  const save = again => {
    const isNew = !editing.id;
    setBusy(true);
    const call = isNew
      ? api.post(`/org-setup/${resource}`, editing)
      : api.put(`/org-setup/${resource}/${editing.id}`, editing);
    call
      .then(() => {
        toast.success(`${singular} ${isNew ? 'added' : 'saved'}`);
        // Submit and New keeps the form open and empty; Submit closes it.
        setEditing(again ? {} : null);
        load();
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  // The route refuses a delete that would strand employees, and says how many.
  // Confirming here as well means the common case never reaches the server.
  //
  // Against totalCount, not the count in the column: the column shows current
  // staff, and a row reading 0 can still be carried by people who have left,
  // whose records every report and payroll history still reads.
  const remove = row => {
    if (row.totalCount > 0) {
      const former = row.totalCount - row.userCount;
      const who = former === row.totalCount
        ? `${former} former employee(s)`
        : former > 0 ? `${row.totalCount} employee(s), ${former} of them former,` : `${row.totalCount} employee(s)`;
      return toast.error(`${who} still have this ${singular.toLowerCase()}. Reassign them first.`);
    }
    if (!window.confirm(`Delete ${row.name}?`)) return;
    api.delete(`/org-setup/${resource}/${row.id}`)
      .then(() => { toast.success(`${singular} deleted`); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  const openPeek = row => {
    if (!row.userCount) return;
    setPeek({ row, list: null });
    api.get(`/org-setup/${resource}/${row.id}/employees`)
      .then(r => setPeek({ row, list: r.data.data || [] }))
      .catch(() => setPeek({ row, list: [] }));
  };

  if (rows === null) return <Spinner />;

  const nameKey = fields[0].key;
  const canSubmit = !busy && !!String(editing?.[nameKey] || '').trim();

  // A function, not a value: computing it unconditionally read `editing[...]`
  // while the list was showing and `editing` was null, which blanked every one
  // of these six screens.
  const renderFields = twoUp => (
    <div className={`grid gap-x-6 gap-y-5 ${twoUp ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
      {fields.map(f => (
        <Field key={f.key} f={f} value={editing[f.key]} rows={rows} excludeId={editing.id}
          record={editing} onChange={set} onQuickAdd={quickAdd} />
      ))}
    </div>
  );

  // ── The full-page editor ────────────────────────────────────────────────
  if (editing && variant === 'page') {
    return (
      <div className="pb-4">
        {/* No overflow-hidden here, unlike the list card: it clipped the lead
            and parent pickers at the card's edge. */}
        <div className="bg-white border border-slate-200 rounded-xl">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200">
            <button onClick={() => setEditing(null)} aria-label="Back"
              className="text-slate-400 hover:text-slate-700"><ArrowLeft size={18} /></button>
            <h2 className="text-[16px] font-semibold text-slate-800">
              {editing.id ? `Edit ${singular}` : `Add ${singular}`}
            </h2>
          </div>

          <div className="px-6 py-6 max-w-4xl">{renderFields(true)}</div>

          <div className="px-6 py-4 border-t border-slate-200 flex flex-wrap items-center gap-3">
            <button
              onClick={() => save(false)} disabled={!canSubmit}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium"
            >
              {busy ? 'Saving…' : 'Submit'}
            </button>
            {/* Only on a new record: "and New" on an edit would silently create
                a second one instead of saving the one on screen. */}
            {!editing.id && (
              <button
                onClick={() => save(true)} disabled={!canSubmit}
                className="border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-60 px-5 py-2 rounded text-[14px] font-medium"
              >
                Submit and New
              </button>
            )}
            <button onClick={() => setEditing(null)}
              className="text-slate-600 hover:text-slate-800 px-3 py-2 text-[14px] font-medium">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
            {description && <p className="text-[13.5px] text-slate-500 mt-1.5">{description}</p>}
          </div>
          <button
            onClick={() => setEditing({})}
            className="flex-shrink-0 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded text-[13.5px] font-medium"
          >
            <Plus size={15} /> Add {singular}
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="px-6 pb-8 pt-2 text-center">
            <p className="text-[14px] text-slate-600">No {title.toLowerCase()} yet.</p>
            {emptyHint && <p className="text-[13px] text-slate-500 mt-1.5">{emptyHint}</p>}
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-[14px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left font-medium text-slate-600 px-6 py-2.5 whitespace-nowrap">{columns[0].label}</th>
                  {/* Second, as the reference has it: the count is the thing
                      you scan a list like this for. */}
                  <th className="text-left font-medium text-slate-600 px-6 py-2.5 whitespace-nowrap">{usersLabel}</th>
                  {columns.slice(1).map(c => (
                    <th key={c.key} className="text-left font-medium text-slate-600 px-6 py-2.5 whitespace-nowrap">{c.label}</th>
                  ))}
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="group border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-6 py-3 align-top">
                      {/* The name opens the editor, the way the reference does
                          — there is no separate pencil column. */}
                      <button onClick={() => setEditing(row)}
                        className="text-blue-600 hover:underline text-left font-medium">
                        {row[columns[0].key]}
                      </button>
                    </td>
                    <td className="px-6 py-3 align-top">
                      {row.userCount > 0 ? (
                        <button onClick={() => openPeek(row)} className="text-blue-600 hover:underline">
                          {row.userCount}
                        </button>
                      ) : <span className="text-slate-400">0</span>}
                    </td>
                    {columns.slice(1).map(c => (
                      <td key={c.key} className="px-6 py-3 text-slate-700 align-top">
                        {c.render ? (c.render(row) || <span className="text-slate-400">—</span>)
                          : (row[c.key] || <span className="text-slate-400">—</span>)}
                      </td>
                    ))}
                    <td className="px-6 py-3 align-top">
                      {/* Hidden until the row is hovered, as in the reference —
                          a delete on every row invites the mis-click. */}
                      <button
                        onClick={() => remove(row)} aria-label={`Delete ${row.name}`}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-400 hover:text-red-500 p-1.5 rounded transition-opacity"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── The slide-over editor ─────────────────────────────────────────── */}
      {editing && variant === 'panel' && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">
                {editing.id ? `Edit ${singular}` : `Add ${singular}`}
              </p>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1">{renderFields(false)}</div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              <button
                onClick={() => save(false)} disabled={!canSubmit}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium"
              >
                {busy ? 'Saving…' : editing.id ? 'Save' : 'Add'}
              </button>
              <button onClick={() => setEditing(null)}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Who is on this row. */}
      {peek && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[15px] font-semibold text-slate-800">
                {usersLabel} — {peek.row.name}
              </p>
              <button onClick={() => setPeek(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto">
              {peek.list === null ? <Spinner /> : peek.list.length === 0 ? (
                <p className="px-6 py-8 text-center text-[14px] text-slate-500">Nobody is on this {singular.toLowerCase()}.</p>
              ) : (
                <table className="w-full text-[14px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left font-medium text-slate-600 px-6 py-2.5">Name</th>
                      <th className="text-left font-medium text-slate-600 px-6 py-2.5">Employee ID</th>
                      <th className="text-left font-medium text-slate-600 px-6 py-2.5">Designation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peek.list.map(e => (
                      <tr key={e.id} className="border-t border-slate-100">
                        <td className="px-6 py-2.5 text-slate-700">{e.name || e.email}</td>
                        <td className="px-6 py-2.5 text-slate-600">{e.employeeId || '—'}</td>
                        <td className="px-6 py-2.5 text-slate-600">{e.designation || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
