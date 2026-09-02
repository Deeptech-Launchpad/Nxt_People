import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Lock, Check, X, Search } from 'lucide-react';
import api from '../../../utils/api';

/* Settings -> Employee Information -> Access Control.
 *
 * Three grids: which fields a role may see, who may import or export, and who
 * may touch the tabular sections.
 *
 * The rule that shapes all of them: THESE ONLY NARROW. Nothing here grants
 * access the code withholds. Identity fields render locked and off, and the
 * server refuses to store them any other way — an administrator hiding a PAN
 * is a legitimate act; an administrator revealing one to everybody is a data
 * breach configured through a settings screen.
 */
const FORMS = [
  { value: 'employee', label: 'Employee' },
  { value: 'department', label: 'Department' },
  { value: 'designation', label: 'Designation' },
];
const select = 'border border-slate-200 rounded-lg px-3 py-2 text-[14.5px] bg-white focus:outline-none focus:border-brand-400';
const roleLabel = r => String(r || '').replace(/_/g, ' ');

function Tick({ on, onClick, disabled, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors
        ${disabled ? 'cursor-not-allowed opacity-50' : ''}
        ${on ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
      {on ? <Check size={15} /> : <X size={15} />}
    </button>
  );
}

/* ── Field permissions ───────────────────────────────────────────────────── */

export function FieldPermissions() {
  const [form, setForm] = useState('employee');
  const [role, setRole] = useState('');
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  const load = (f = form, r = role) => {
    api.get(`/employee-info-permissions/fields?form=${f}${r ? `&role=${encodeURIComponent(r)}` : ''}`)
      .then(res => {
        setData(res.data.data);
        if (!r && res.data.data.roles?.length) setRole(res.data.data.roles[0]);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load field permissions'));
  };
  useEffect(() => { load(form, role); }, [form, role]);

  const setField = (sectionKey, key, patch) => {
    setData(d => ({
      ...d,
      sections: d.sections.map(s => s.key !== sectionKey ? s : {
        ...s,
        fields: s.fields.map(f => f.key !== key ? f : { ...f, ...patch }),
      }),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const fields = data.sections.flatMap(s => s.fields.map(f => ({
        key: f.key, canView: f.canView, canEdit: f.canEdit,
      })));
      await api.put('/employee-info-permissions/fields', { form, role, fields });
      toast.success('Saved');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save those permissions');
    } finally { setSaving(false); }
  };

  if (!data) {
    return <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  const match = f => !q.trim() || f.label.toLowerCase().includes(q.trim().toLowerCase());

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-[14px] text-slate-500">Form</label>
        <select className={select} value={form} onChange={e => setForm(e.target.value)}>
          {FORMS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <label className="text-[14px] text-slate-500 ml-2">Role</label>
        <select className={select} value={role} onChange={e => setRole(e.target.value)}>
          {(data.roles || []).map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${select} pl-8 w-56`} value={q} placeholder="Search"
            onChange={e => setQ(e.target.value)} />
        </div>
        <button onClick={save} disabled={saving}
          className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-5 h-10 rounded-lg text-[15px] font-medium">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <p className="text-[13.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
        These settings only take access away. Full access is unaffected, and identity numbers stay behind
        the audited reveal whatever is set here — an audit trail an administrator can switch off is not one.
      </p>

      <div className="space-y-3">
        {data.sections.map(s => {
          const fields = s.fields.filter(match);
          if (!fields.length) return null;
          return (
            <div key={s.key} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                <span className="text-[15px] font-medium text-slate-700 flex items-center gap-2">
                  {s.label}
                  {s.protected && (
                    <span className="inline-flex items-center gap-1 text-[12px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
                      <Lock size={11} /> always restricted
                    </span>
                  )}
                </span>
              </div>
              <table className="w-full text-[14.5px]">
                <thead className="text-slate-500 text-[13px]">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Name</th>
                    <th className="px-4 py-2 text-left font-medium w-24">View</th>
                    <th className="px-4 py-2 text-left font-medium w-24">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map(f => (
                    <tr key={f.key} className="border-t border-slate-50">
                      <td className={`px-4 py-2 ${f.locked ? 'text-slate-400' : 'text-slate-700'}`}>{f.label}</td>
                      <td className="px-4 py-2">
                        <Tick on={f.canView} disabled={f.locked}
                          title={f.locked ? 'Only ever visible through the audited reveal' : undefined}
                          onClick={() => setField(s.key, f.key, { canView: !f.canView, ...(f.canView ? { canEdit: false } : {}) })} />
                      </td>
                      <td className="px-4 py-2">
                        {/* Editing something you cannot see is not a state any
                            screen can express, so it follows View. */}
                        <Tick on={f.canEdit} disabled={f.locked || !f.canView}
                          title={f.locked ? 'Not editable here' : (!f.canView ? 'Give View first' : undefined)}
                          onClick={() => setField(s.key, f.key, { canEdit: !f.canEdit })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Import / Export permissions ─────────────────────────────────────────── */

export function ImportExportPermissions() {
  const [form, setForm] = useState('employee');
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = (f = form) => {
    api.get(`/employee-info-permissions/import-export?form=${f}`)
      .then(r => setRows(r.data.data.rows || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load permissions'));
  };
  useEffect(() => { load(form); }, [form]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/employee-info-permissions/import-export', { form, rows });
      toast.success('Saved');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save');
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-[14px] text-slate-500">Form</label>
        <select className={select} value={form} onChange={e => setForm(e.target.value)}>
          {FORMS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <button onClick={save} disabled={saving}
          className="ml-auto bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-5 h-10 rounded-lg text-[15px] font-medium">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <p className="text-[13.5px] text-slate-500">
        Full access can always import and export. These switches grant it to a narrower role.
      </p>

      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <table className="w-full text-[15px]">
          <thead className="bg-slate-50 text-slate-500 text-[13.5px]">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Role name</th>
              <th className="px-4 py-2.5 text-left font-medium w-32">Import</th>
              <th className="px-4 py-2.5 text-left font-medium w-32">Export</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.role} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-800 capitalize">{roleLabel(r.role)}</td>
                <td className="px-4 py-2.5">
                  <Tick on={r.canImport}
                    onClick={() => setRows(rs => rs.map((x, j) => j === i ? { ...x, canImport: !x.canImport } : x))} />
                </td>
                <td className="px-4 py-2.5">
                  <Tick on={r.canExport}
                    onClick={() => setRows(rs => rs.map((x, j) => j === i ? { ...x, canExport: !x.canExport } : x))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Tabular section permissions ─────────────────────────────────────────── */

export function TabularSectionPermissions() {
  const [form, setForm] = useState('employee');
  const [section, setSection] = useState('education');
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get(`/employee-info-permissions/tabular?form=${form}&section=${section}`)
      .then(r => setData(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load permissions'));
  };
  useEffect(load, [form, section]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/employee-info-permissions/tabular', { form, section, rows: data.rows });
      toast.success('Saved');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save');
    } finally { setSaving(false); }
  };

  if (!data) {
    return <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  const flip = (i, key) => setData(d => ({
    ...d, rows: d.rows.map((x, j) => j === i ? { ...x, [key]: !x[key] } : x),
  }));

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-[14px] text-slate-500">Form</label>
        <select className={select} value={form} onChange={e => setForm(e.target.value)}>
          {FORMS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <label className="text-[14px] text-slate-500 ml-2">Tabular Sections</label>
        <select className={select} value={section} onChange={e => setSection(e.target.value)}>
          {(data.sections || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button onClick={save} disabled={saving || !data.built}
          className="ml-auto bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-5 h-10 rounded-lg text-[15px] font-medium">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Two of the three sections have no table behind them yet, so
          permissions on them would govern nothing. Said plainly rather than
          shown as a working grid. */}
      {!data.built && (
        <p className="text-[13.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3.5 py-2.5">
          This section is not built yet — there is no table behind it, so these permissions would not
          govern anything. Education Details is the one that is real.
        </p>
      )}

      <div className={`border border-slate-200 rounded-xl bg-white overflow-hidden ${data.built ? '' : 'opacity-50'}`}>
        <table className="w-full text-[15px]">
          <thead className="bg-slate-50 text-slate-500 text-[13.5px]">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Role name</th>
              <th className="px-4 py-2.5 text-left font-medium w-24">Add</th>
              <th className="px-4 py-2.5 text-left font-medium w-24">Edit</th>
              <th className="px-4 py-2.5 text-left font-medium w-24">Delete</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.role} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-800 capitalize">{roleLabel(r.role)}</td>
                <td className="px-4 py-2.5"><Tick on={r.canAdd} disabled={!data.built} onClick={() => flip(i, 'canAdd')} /></td>
                <td className="px-4 py-2.5"><Tick on={r.canEdit} disabled={!data.built} onClick={() => flip(i, 'canEdit')} /></td>
                <td className="px-4 py-2.5"><Tick on={r.canDelete} disabled={!data.built} onClick={() => flip(i, 'canDelete')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
