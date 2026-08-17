import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Building2, ChevronDown, ChevronRight, Plus, Trash2, X, Network, Layers } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';

// Organization Structure → Manage Structure.
//
// The tree the reference draws: the organization at the root, its legal
// entities beneath, then business units, then divisions — which nest further.
// Every node offers, on hover, the one thing you would come here to do: add the
// level below it, or remove it.
//
// The tree is read from the server rather than assembled here from four list
// calls, because the nesting of divisions is recursive and doing it in two
// places is how the two disagree.

const ICON = { org: Building2, company: Building2, business_unit: Network, division: Layers };

// What a node's child is created as: the resource, and the field that ties it
// to the node it was added under.
const CHILD_OF = {
  org:           { resource: 'companies',      parentKey: null,             labelKey: 'legalEntity' },
  company:       { resource: 'business_units', parentKey: 'companyId',      labelKey: 'businessUnit' },
  business_unit: { resource: 'divisions',      parentKey: 'businessUnitId', labelKey: 'division' },
  division:      { resource: 'divisions',      parentKey: 'parentId',       labelKey: 'division' },
};

const RESOURCE_OF = { company: 'companies', business_unit: 'business_units', division: 'divisions' };

function Node({ node, kind, depth, labels, onAdd, onDelete }) {
  const [open, setOpen] = useState(depth < 2);
  const kids = node.children || [];
  const Icon = ICON[kind] || Layers;
  const child = CHILD_OF[kind];

  return (
    <div>
      <div
        className="group flex items-center gap-2 py-2 pr-3 rounded-lg hover:bg-slate-50"
        style={{ paddingLeft: 8 + depth * 22 }}
      >
        <button
          onClick={() => setOpen(o => !o)}
          className={`text-slate-400 hover:text-slate-600 ${kids.length ? '' : 'invisible'}`}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>

        <Icon size={15} className="text-slate-400 flex-shrink-0" />
        <span className={`text-[14px] truncate ${kind === 'org' ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>
          {node.name}
        </span>
        {kids.length > 0 && <span className="text-[12.5px] text-slate-400">({kids.length})</span>}

        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {child && (
            <button
              onClick={() => onAdd(kind, node)}
              title={`Add ${labels[child.labelKey]}`}
              className="text-slate-400 hover:text-blue-600 p-1.5 rounded"
            >
              <Plus size={15} />
            </button>
          )}
          {kind !== 'org' && (
            <button
              onClick={() => onDelete(kind, node)}
              title={`Delete ${node.name}`}
              className="text-slate-400 hover:text-red-500 p-1.5 rounded"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {open && kids.map(c => (
        <Node
          key={`${c.kind}-${c.id}`} node={c} kind={c.kind} depth={depth + 1}
          labels={labels} onAdd={onAdd} onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export default function ManageStructure() {
  const [tree, setTree] = useState(null);
  const [adding, setAdding] = useState(null);   // { resource, parentKey, parentId, label }
  const [form, setForm] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/org-details/structure/tree')
      .then(r => setTree(r.data.data))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load the structure'); setTree(false); });
  }, []);

  useEffect(load, [load]);

  const onAdd = (kind, node) => {
    const c = CHILD_OF[kind];
    setForm({ name: '', description: '' });
    setAdding({
      resource: c.resource,
      parentKey: c.parentKey,
      parentId: node.id || null,
      label: tree.labels[c.labelKey],
      under: node.name,
    });
  };

  const submit = () => {
    setBusy(true);
    const body = { name: form.name.trim(), description: form.description.trim() || null };
    if (adding.parentKey) body[adding.parentKey] = adding.parentId;
    api.post(`/org-setup/${adding.resource}`, body)
      .then(() => { toast.success(`${adding.label} added`); setAdding(null); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not add'))
      .finally(() => setBusy(false));
  };

  // The route refuses a delete that would strand employees or orphan the level
  // below, and says which. Nothing is cascaded here.
  const onDelete = (kind, node) => {
    if (!window.confirm(`Delete ${node.name}?`)) return;
    api.delete(`/org-setup/${RESOURCE_OF[kind]}/${node.id}`)
      .then(() => { toast.success('Deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  if (tree === null) return <Spinner />;
  if (tree === false) return null;

  const stray = [
    ...tree.unplaced.businessUnits.map(u => ({ ...u, kind: 'business_unit' })),
    ...tree.unplaced.divisions.map(d => ({ ...d, kind: 'division' })),
  ];

  return (
    <div className="space-y-4 pb-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <h2 className="text-[15px] font-semibold text-slate-800">Manage Structure</h2>
          <p className="text-[13.5px] text-slate-500 mt-1.5">
            The organization, its {tree.labels.legalEntity.toLowerCase()} entries, and everything under them.
            Hover a row to add the level below it or remove it.
          </p>
          {!tree.enabled && (
            <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
              The structure is switched off, so employees are not assigned to it yet.
              Turn it on under Organization Structure → Configuration.
            </p>
          )}
        </div>

        <div className="px-3 py-3">
          <Node
            node={{ name: tree.name, children: tree.children }}
            kind="org" depth={0} labels={tree.labels}
            onAdd={onAdd} onDelete={onDelete}
          />
        </div>
      </div>

      {/* A business unit with no company, or a division with no business unit,
          has nowhere to hang in the tree. Hiding it would be the worse answer:
          it exists, and it is assignable. */}
      {stray.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-[14px] font-semibold text-slate-800">Not placed</h3>
            <p className="text-[13px] text-slate-500 mt-1">
              These exist but have no parent, so they do not appear in the tree above.
            </p>
          </div>
          <div className="px-3 py-2">
            {stray.map(s => (
              <div key={`${s.kind}-${s.id}`} className="group flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-slate-50">
                {s.kind === 'business_unit' ? <Network size={15} className="text-slate-400" /> : <Layers size={15} className="text-slate-400" />}
                <span className="text-[14px] text-slate-700">{s.name}</span>
                <span className="text-[12.5px] text-slate-400">
                  {s.kind === 'business_unit' ? tree.labels.businessUnit : tree.labels.division}
                </span>
                <button
                  onClick={() => onDelete(s.kind, s)}
                  className="ml-auto opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1.5 rounded"
                  title={`Delete ${s.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <p className="text-[16px] font-semibold text-slate-800">Add {adding.label}</p>
                <p className="text-[12.5px] text-slate-500 mt-0.5 truncate">Under {adding.under}</p>
              </div>
              <button onClick={() => setAdding(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Name<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  autoFocus value={form.name} maxLength={150}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
                <textarea
                  rows={3} value={form.description} maxLength={100}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              <button
                onClick={submit} disabled={busy || !form.name.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium"
              >
                {busy ? 'Adding…' : 'Add'}
              </button>
              <button onClick={() => setAdding(null)}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
