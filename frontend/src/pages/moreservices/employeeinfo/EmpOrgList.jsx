import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Upload, Download } from 'lucide-react';
import api from '../../../utils/api';
import DataListView from '../../../components/listview/DataListView';
import ViewPicker from '../../../components/listview/ViewPicker';
import ScopeSelect from './ScopeSelect';
import useListView from './useListView';
import ImportDialog from '../../../components/listview/ImportDialog';
import downloadFile from '../../../components/listview/downloadFile';

/* Departments and Designations.
 *
 * One component for both, because the reference's two screens differ only in
 * their columns and their add form — the toolbar, filter, paging, sorting and
 * row menu are identical. Two copies would drift.
 *
 * Both are backed by /org-setup, which already had the CRUD, the delete guard
 * and (for departments) the ancestor-cycle check. This adds the list chrome on
 * top rather than a second set of write routes.
 */
const fmtDateTime = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};
const dash = v => (v === null || v === undefined || v === '' ? <span className="text-slate-300">—</span> : v);
const input = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
const label = 'block text-[14px] font-medium text-slate-600 mb-1.5';

export default function EmpOrgList({ resource, title, singular, extraColumns = [], extraFields = [], FormFields }) {
  const lv = useListView({ endpoint: `/org-setup/${resource}`, module: resource, defaultSort: { by: 'name', dir: 'asc' } });
  const [form, setForm] = useState(null);       // null | {} for new | row for edit
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState([]);

  // Widths, so one long designation cannot stretch its column across the
  // screen and squeeze the dates out of view.
  const columns = useMemo(() => [
    { key: 'name', label: `${singular} Name`, width: 260 },
    { key: 'mailAlias', label: 'Mail Alias', width: 170, render: r => dash(r.mailAlias) },
    ...extraColumns,
    { key: 'addedBy', label: 'Added By', width: 180, render: r => dash(r.addedBy) },
    { key: 'addedTime', label: 'Added Time', width: 170, render: r => dash(fmtDateTime(r.addedTime)) },
    { key: 'modifiedBy', label: 'Modified By', width: 180, render: r => dash(r.modifiedBy) },
    { key: 'modifiedTime', label: 'Modified Time', width: 170, render: r => dash(fmtDateTime(r.modifiedTime)) },
  ], [extraColumns, singular]);

  const fields = useMemo(() => [
    { key: 'name', label: `${singular} Name`, type: 'text' },
    { key: 'mailAlias', label: 'Mail Alias', type: 'text' },
    ...extraFields,
    { key: 'addedBy', label: 'Added By', type: 'text' },
    { key: 'addedTime', label: 'Added Time', type: 'datetime' },
    { key: 'modifiedBy', label: 'Modified By', type: 'text' },
    { key: 'modifiedTime', label: 'Modified Time', type: 'datetime' },
  ], [extraFields, singular]);

  const save = async (andNew) => {
    if (!String(form.name || '').trim()) return toast.error(`${singular} name is required`);
    setSaving(true);
    try {
      if (form.id) await api.put(`/org-setup/${resource}/${form.id}`, form);
      else await api.post(`/org-setup/${resource}`, form);
      toast.success(form.id ? `${singular} updated` : `${singular} added`);
      if (andNew) setForm({ name: '', mailAlias: '' });
      else setForm(null);
      lv.reload();
    } catch (err) {
      toast.error(err.response?.data?.message || `Could not save that ${singular.toLowerCase()}`);
    } finally { setSaving(false); }
  };

  const remove = async () => {
    try {
      await api.delete(`/org-setup/${resource}/${toDelete.id}`);
      toast.success(`${singular} deleted`);
      setToDelete(null); lv.reload();
    } catch (err) {
      // The server refuses to delete one that still has people on it, and says
      // how many — pass that through rather than a generic failure.
      toast.error(err.response?.data?.message || `Could not delete that ${singular.toLowerCase()}`);
      setToDelete(null);
    }
  };

  return (
    <>
      <DataListView
        columns={columns} fields={fields}
        rows={lv.rows} total={lv.total} loading={lv.loading}
        page={lv.page} limit={lv.limit} onPage={lv.setPage} onLimit={lv.setLimit}
        sort={lv.sort} onSort={lv.onSort}
        criteria={lv.criteria} onCriteria={lv.onCriteria}
        hidden={lv.hidden} onHidden={lv.onHidden}
        selectable selected={picked} onSelected={setPicked}
        // Only rows with nobody on them can go: the server refuses the rest
        // and a tick that always fails is worse than one that is not offered.
        selectableRow={r => !r.userCount}
        bulkActions={[
          { label: `Delete ${picked.length}`, danger: true, onClick: async () => {
              const rows = lv.rows.filter(r => picked.includes(r.id));
              let ok = 0; const failed = [];
              for (const r of rows) {
                try { await api.delete(`/org-setup/${resource}/${r.id}`); ok++; }
                catch (err) { failed.push(err.response?.data?.message || r.name); }
              }
              setPicked([]); lv.reload();
              if (ok) toast.success(`${ok} deleted`);
              if (failed.length) toast.error(`${failed.length} could not be deleted - ${failed[0]}`, { duration: 6000 });
            } },
        ]}
        toolbarLeft={
          <ViewPicker module={resource} fields={fields} active={lv.view}
            defaultLabel={`${singular} View`}
            onSelect={v => lv.onView(v, columns.map(c => c.key))} />
        }
        toolbarRight={
          <>
            <ScopeSelect value={lv.scope} onChange={lv.onScope} />
            <button onClick={() => setForm({ name: '', mailAlias: '' })}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 h-10 rounded-lg text-[15px] font-medium">
              <Plus size={16} /> Add {singular}
            </button>
          </>
        }
        toolbarMenu={[
          { label: 'Import', icon: <Upload size={15} />, onClick: () => setImporting(true) },
          { label: 'Export', icon: <Download size={15} />, onClick: () => downloadFile(
              `/employee-io/export/${resource}${lv.criteria.length
                ? `?criteria=${encodeURIComponent(JSON.stringify(lv.criteria))}` : ''}`,
              `${resource}-${new Date().toISOString().slice(0, 10)}.xlsx`) },
          { label: 'History Export', icon: <Download size={15} />, onClick: () => downloadFile(
              `/employee-io/history-export/${resource}`,
              `${resource}-history-${new Date().toISOString().slice(0, 10)}.xlsx`) },
        ]}
        rowMenu={(r) => [
          { label: 'Edit', icon: <Pencil size={15} />, onClick: () => setForm({ ...r }) },
          { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onClick: () => setToDelete(r) },
        ]}
        emptyText={`No ${title.toLowerCase()} yet.`}
      />

      {importing && (
        <ImportDialog module={resource} title={title}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); lv.reload(); }} />
      )}

      {form && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-xl">
                {form.id ? `Edit ${singular}` : `Add ${singular}`}
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-4">
                {singular} Details
              </p>
              <div className="space-y-4">
                <div>
                  <label className={label}>{singular} Name <span className="text-rose-500">*</span></label>
                  <input className={input} value={form.name || ''}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className={label}>Mail Alias</label>
                  <input className={input} value={form.mailAlias || ''}
                    onChange={e => setForm(f => ({ ...f, mailAlias: e.target.value }))} />
                </div>
                {FormFields && <FormFields form={form} setForm={setForm} input={input} label={label} />}
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
              <button onClick={() => save(false)} disabled={saving}
                className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
                {saving ? 'Saving…' : 'Submit'}
              </button>
              {!form.id && (
                <button onClick={() => save(true)} disabled={saving}
                  className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
                  Submit and New
                </button>
              )}
              <button onClick={() => setForm(null)}
                className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl text-[15px] hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h3 className="font-display font-semibold text-slate-800 text-xl">Delete {toDelete.name}?</h3>
            <p className="text-[14px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 mt-3">
              {toDelete.userCount > 0
                ? `${toDelete.userCount} employee(s) are on this ${singular.toLowerCase()}. It cannot be deleted until they are moved.`
                : 'This cannot be undone.'}
            </p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setToDelete(null)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={remove}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-2.5 rounded-xl text-[15px] font-medium">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
