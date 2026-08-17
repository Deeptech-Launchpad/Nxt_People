import React from 'react';
import { Trash2 } from 'lucide-react';

// Two shapes the Attendance configuration screens use more than once: a list of
// short labels an admin types, and the show/mandatory grid that decides which
// fields a request form asks for.

export function ListEditor({ items, onChange, addLabel, placeholder, max = 20 }) {
  const list = Array.isArray(items) ? items : [];
  const setAt = (i, value) => onChange(list.map((x, n) => (n === i ? value : x)));
  // Blanks are dropped on save, but removing a row outright is what the delete
  // control is for — an emptied row that lingers looks like a saved value.
  const removeAt = i => onChange(list.filter((_, n) => n !== i));

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-4 inline-block min-w-[260px]">
      <div className="space-y-2.5">
        {list.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={item}
              placeholder={placeholder}
              onChange={e => setAt(i, e.target.value)}
              className="w-[210px] text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
            <button
              onClick={() => removeAt(i)}
              aria-label={`Remove ${item || 'entry'}`}
              className="text-slate-400 hover:text-red-500 p-1 rounded"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {list.length === 0 && (
          <p className="text-[13px] text-slate-500 w-[210px]">Nothing added yet.</p>
        )}
      </div>
      <button
        onClick={() => onChange([...list, ''])}
        disabled={list.length >= max}
        className="mt-3 text-[13.5px] text-blue-600 hover:text-blue-500 disabled:text-slate-400 bg-blue-50 disabled:bg-slate-100 rounded px-3 py-1.5"
      >
        {addLabel}
      </button>
    </div>
  );
}

// Rows of "Field | Show | Mandatory". Mandatory is disabled while the field is
// hidden, because requiring something nobody is shown makes the form
// unsubmittable — the route enforces the same rule on save.
export function FieldVisibilityTable({ rows, values, onChange }) {
  return (
    <div className="inline-block border border-slate-200 rounded-lg overflow-hidden">
      <table className="text-[14px]">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left font-medium text-slate-600 px-4 py-2.5 w-[200px]">Field</th>
            <th className="font-medium text-slate-600 px-6 py-2.5">Show</th>
            <th className="font-medium text-slate-600 px-6 py-2.5">Mandatory</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const v = values?.[row.key] || {};
            return (
              <tr key={row.key} className="border-t border-slate-200">
                <td className="px-4 py-3 text-slate-700">{row.label}</td>
                <td className="px-6 py-3 text-center">
                  <input
                    type="checkbox" checked={!!v.show}
                    aria-label={`Show ${row.label}`}
                    onChange={e => onChange(row.key, { show: e.target.checked, mandatory: e.target.checked && !!v.mandatory })}
                    className="w-4 h-4 accent-blue-600"
                  />
                </td>
                <td className="px-6 py-3 text-center">
                  <input
                    type="checkbox" checked={!!v.mandatory} disabled={!v.show}
                    aria-label={`${row.label} mandatory`}
                    onChange={e => onChange(row.key, { show: !!v.show, mandatory: e.target.checked })}
                    className="w-4 h-4 accent-blue-600 disabled:opacity-40"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// A permissions grid with arbitrary columns — used by the Expected vs worked
// hours report block, which crosses View/Edit with manager and employee.
export function PermissionMatrix({ columns, rows, values, onChange }) {
  return (
    <div className="inline-block border border-slate-200 rounded-lg overflow-hidden">
      <table className="text-[14px]">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left font-medium text-slate-600 px-4 py-2.5 w-[130px]">Permissions</th>
            {columns.map(c => (
              <th key={c.key} className="font-medium text-slate-600 px-5 py-2.5 whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-t border-slate-200">
              <td className="px-4 py-3 text-slate-700">{r.label}</td>
              {columns.map(c => (
                <td key={c.key} className="px-5 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={!!values?.[r.key]?.[c.key]}
                    disabled={r.requires ? !values?.[r.requires]?.[c.key] : false}
                    aria-label={`${r.label} — ${c.label}`}
                    onChange={e => onChange(r.key, c.key, e.target.checked)}
                    className="w-4 h-4 accent-blue-600 disabled:opacity-40"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
