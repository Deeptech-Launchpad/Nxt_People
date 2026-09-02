import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X, Pencil, Trash2, Users, Briefcase } from 'lucide-react';
import api from '../../../utils/api';

/* Settings -> Employee Information -> Policy -> Streams.
 *
 * A stream groups designations and people across departments — "everyone doing
 * QA", say, wherever they report. Members are one list holding both kinds,
 * because every reader wants "who is in this stream" as a single answer.
 *
 * The section only appears when Streams is switched on in Basic Details, so
 * an organisation that does not use them never sees an empty screen.
 */
const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-[14.5px] focus:outline-none focus:border-brand-400';

function MemberPicker({ label, icon, items, chosen, onChange, searchable }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!searchable) return;
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/employees?limit=8&search=${encodeURIComponent(q.trim())}`)
        .then(r => setResults(r.data.data || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, searchable]);

  return (
    <div>
      <label className="block text-[14px] font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
        {icon} {label}
      </label>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {chosen.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1.5 bg-slate-100 rounded-lg px-2 py-1 text-[13.5px] text-slate-700">
              {c.label}
              <button onClick={() => onChange(chosen.filter(x => x.id !== c.id))}
                className="text-slate-400 hover:text-rose-600"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      {searchable ? (
        <div className="relative">
          <input className={input} value={q} placeholder="Search employee"
            onChange={e => setQ(e.target.value)} />
          {results.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-48 overflow-y-auto">
              {results.map(p => (
                <button key={p._id}
                  onClick={() => {
                    if (!chosen.some(c => c.id === p._id)) {
                      onChange([...chosen, { id: p._id, label: `${p.employeeId} ${p.firstName} ${p.lastName || ''}`.trim() }]);
                    }
                    setQ(''); setResults([]);
                  }}
                  className="w-full text-left px-3 py-1.5 text-[13.5px] text-slate-700 hover:bg-slate-50">
                  {p.employeeId} {p.firstName} {p.lastName}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map(d => {
            const on = chosen.some(c => c.id === d.id);
            return (
              <button key={d.id}
                onClick={() => onChange(on ? chosen.filter(c => c.id !== d.id) : [...chosen, { id: d.id, label: d.name }])}
                className={`px-2.5 py-1 rounded-lg text-[13.5px] border transition-colors
                  ${on ? 'bg-brand-50 border-brand-300 text-brand-700'
                       : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                {d.name}
              </button>
            );
          })}
          {items.length === 0 && <span className="text-[13.5px] text-slate-400">Loading…</span>}
        </div>
      )}
    </div>
  );
}

function StreamEditor({ stream, designations, onClose, onSaved }) {
  const [name, setName] = useState(stream?.name || '');
  const [description, setDescription] = useState(stream?.description || '');
  const [people, setPeople] = useState([]);
  const [desigs, setDesigs] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!stream?._id) return;
    api.get(`/employee-info-settings/streams/${stream._id}`)
      .then(r => {
        const m = r.data.data.members || [];
        setPeople(m.filter(x => x.employeeId).map(x => ({ id: x.employeeId, label: `${x.code || ''} ${x.employeeName || ''}`.trim() })));
        setDesigs(m.filter(x => x.designationId).map(x => ({ id: x.designationId, label: x.designationName })));
      })
      .catch(() => {});
  }, [stream]);

  const save = async () => {
    if (!name.trim()) return toast.error('Give the stream a name');
    setSaving(true);
    try {
      const body = {
        name: name.trim(), description: description.trim(),
        employees: people.map(p => p.id), designations: desigs.map(d => d.id),
      };
      if (stream?._id) await api.put(`/employee-info-settings/streams/${stream._id}`, body);
      else await api.post('/employee-info-settings/streams', body);
      toast.success(stream ? 'Stream updated' : 'Stream added');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that stream');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-4 flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-xl">
            {stream ? 'Edit Stream' : 'Add Stream'}
          </h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={19} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-[14px] font-medium text-slate-700 mb-1.5">
              Stream name <span className="text-rose-500">*</span>
            </label>
            <input className={input} value={name} autoFocus onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-[14px] font-medium text-slate-700 mb-1.5">Description</label>
            <textarea className={`${input} h-20 resize-none`} value={description}
              onChange={e => setDescription(e.target.value)} />
          </div>
          <MemberPicker label="Designations" icon={<Briefcase size={14} className="text-slate-400" />}
            items={designations} chosen={desigs} onChange={setDesigs} />
          <MemberPicker label="Employees" icon={<Users size={14} className="text-slate-400" />}
            items={[]} chosen={people} onChange={setPeople} searchable />
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={save} disabled={saving}
            className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose}
            className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl text-[15px] hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Streams() {
  const [rows, setRows] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [enabled, setEnabled] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/employee-info-settings/streams'),
      api.get('/employee-info-settings/basic-details'),
      api.get('/org-setup/designations').catch(() => ({ data: { data: [] } })),
    ])
      .then(([s, b, d]) => {
        setRows(s.data.data || []);
        setEnabled(!!b.data.data?.streams);
        setDesignations(d.data.data || []);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load streams'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const remove = async (row) => {
    try { await api.delete(`/employee-info-settings/streams/${row._id}`); toast.success('Removed'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Could not remove that'); }
  };

  if (loading) {
    return <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  return (
    <div className="max-w-4xl space-y-4">
      {/* The feature has its own switch in Basic Details. Managing streams
          while it is off would build data nothing reads. */}
      {enabled === false && (
        <p className="text-[14px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
          Streams are switched off. Turn them on in <strong>Policy → Basic Details</strong> before setting
          any up — anything created here is not used while the feature is off.
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[14px] text-slate-500 max-w-2xl">
          Group related designations or employees together under one stream — a grouping that cuts across
          departments.
        </p>
        <button onClick={() => setEditing('new')}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 h-10 rounded-lg text-[15px] font-medium whitespace-nowrap">
          <Plus size={16} /> Add Stream
        </button>
      </div>

      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <table className="w-full text-[15px]">
          <thead className="bg-slate-50 text-slate-500 text-[13.5px]">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Stream</th>
              <th className="px-4 py-2.5 text-left font-medium">Description</th>
              <th className="px-4 py-2.5 text-left font-medium w-32">Designations</th>
              <th className="px-4 py-2.5 text-left font-medium w-28">People</th>
              <th className="px-4 py-2.5 w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="py-14 text-center text-slate-400">No streams yet.</td></tr>
            ) : rows.map(r => (
              <tr key={r._id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-800">{r.name}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.description || <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2.5 text-slate-500 tabular-nums">{r.designationCount}</td>
                <td className="px-4 py-2.5 text-slate-500 tabular-nums">{r.employeeCount}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditing(r)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => remove(r)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <StreamEditor stream={editing === 'new' ? null : editing} designations={designations}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}
