import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  Globe, Plus, Pencil, Trash2, RefreshCw, Copy, Check, Eye, EyeOff, X, Zap,
  Users, Search, Layers, BookOpen, BarChart3, Briefcase, Calendar, Cloud, Cog,
  Database, FileText, Image, Lock, Mail, Map, Phone, Server, Star, Tag,
} from 'lucide-react';

const DATA_TYPES = ['employees', 'attendance', 'leaves', 'timesheets'];

// Icons the admin can pick for a user-facing app (shows in the launcher).
const APP_ICONS = {
  Layers, Globe, BookOpen, BarChart3, Briefcase, Calendar, Cloud, Cog,
  Database, FileText, Image, Lock, Mail, Map, Phone, Server, Star, Tag,
};
const APP_ICON_NAMES = Object.keys(APP_ICONS);
const APP_COLORS = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-purple-500 to-fuchsia-600',
  'from-sky-500 to-cyan-600',
  'from-slate-700 to-slate-900',
];
const AppIcon = ({ name, ...rest }) => {
  const Cmp = APP_ICONS[name] || Layers;
  return <Cmp {...rest} />;
};

function ConnectionModal({ connection, onClose, onSaved }) {
  const isEdit = !!connection;
  const [form, setForm] = useState(
    isEdit
      ? { name: connection.name, websiteUrl: connection.websiteUrl || '', description: connection.description || '', company: connection.company || '', isActive: connection.isActive, allowedDataTypes: connection.allowedDataTypes || ['employees'], isUserApp: !!connection.isUserApp, appIcon: connection.appIcon || 'Layers', appColor: connection.appColor || 'from-blue-500 to-indigo-600' }
      : { name: '', websiteUrl: '', description: '', company: '', isActive: true, allowedDataTypes: ['employees'], isUserApp: false, appIcon: 'Layers', appColor: 'from-blue-500 to-indigo-600' }
  );
  const [loading, setLoading] = useState(false);

  const toggleType = (type) => {
    setForm(f => ({
      ...f,
      allowedDataTypes: f.allowedDataTypes.includes(type)
        ? f.allowedDataTypes.filter(t => t !== type)
        : [...f.allowedDataTypes, type]
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Connection name is required');
    if (form.allowedDataTypes.length === 0) return toast.error('Select at least one data type');
    setLoading(true);
    try {
      if (isEdit) {
        await api.put(`/api-connections/${connection._id}`, form);
        toast.success('Connection updated');
        onSaved(null);
      } else {
        const r = await api.post('/api-connections', form);
        toast.success('Connection created');
        // Pass the raw key up so the parent can show the reveal modal.
        onSaved({ name: form.name, apiKey: r.data.data?.apiKey });
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display font-bold text-slate-800 text-xl">{isEdit ? 'Edit Connection' : 'New API Connection'}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 transition-colors"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1.5">Connection name <span className="text-red-400">*</span></label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-white border border-slate-200 text-slate-800 px-3 py-2.5 rounded-xl text-base focus:outline-none focus:border-brand-500 placeholder-slate-400" placeholder="e.g. Main Website" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1.5">Website URL</label>
            <input value={form.websiteUrl} onChange={e => setForm(f => ({ ...f, websiteUrl: e.target.value }))} className="w-full bg-white border border-slate-200 text-slate-800 px-3 py-2.5 rounded-xl text-base focus:outline-none focus:border-brand-500 placeholder-slate-400" placeholder="https://website.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1.5">Company filter</label>
            <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} className="w-full bg-white border border-slate-200 text-slate-800 px-3 py-2.5 rounded-xl text-base focus:outline-none focus:border-brand-500 placeholder-slate-400" placeholder="Restrict to this company (optional)" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1.5">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full bg-white border border-slate-200 text-slate-800 px-3 py-2.5 rounded-xl text-base focus:outline-none focus:border-brand-500 placeholder-slate-400 resize-none" placeholder="What does this connection do?" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-2">Allowed data types <span className="text-red-400">*</span></label>
            <div className="flex flex-wrap gap-2">
              {DATA_TYPES.map(type => (
                <button key={type} type="button" onClick={() => toggleType(type)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${form.allowedDataTypes.includes(type) ? 'bg-brand-600/30 border-brand-500/50 text-brand-300' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-600'}`}>
                  {type}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Active</span>
            <button type="button" onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))} className={`relative w-10 h-5.5 rounded-full transition-all ${form.isActive ? 'bg-brand-600' : 'bg-slate-200'}`} style={{ height: '22px' }}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${form.isActive ? 'left-5.5' : 'left-0.5'}`} style={{ left: form.isActive ? '22px' : '2px' }} />
            </button>
          </div>

          {/* User-facing app toggle — when on, this connection shows in the
              My Apps launcher and gets a per-employee access list. */}
          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-700">User-facing app</p>
                <p className="text-[13px] text-slate-500 mt-0.5 leading-relaxed">Turn on if this is a website employees log into (LMS, User Report, etc.). Shows in the My Apps launcher; admins pick who can access.</p>
              </div>
              <button type="button" onClick={() => setForm(f => ({ ...f, isUserApp: !f.isUserApp }))} className={`relative flex-shrink-0 rounded-full transition-all ${form.isUserApp ? 'bg-brand-600' : 'bg-slate-200'}`} style={{ height: '22px', width: '40px' }}>
                <span className="absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all" style={{ left: form.isUserApp ? '22px' : '2px' }} />
              </button>
            </div>

            {form.isUserApp && (
              <div className="mt-3 space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div>
                  <label className="block text-[13px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Launcher Icon</label>
                  <div className="grid grid-cols-9 gap-1 bg-white border border-slate-200 rounded-lg p-1.5 max-h-[88px] overflow-y-auto">
                    {APP_ICON_NAMES.map(n => (
                      <button key={n} type="button" onClick={() => setForm(f => ({ ...f, appIcon: n }))}
                        className={`p-1.5 rounded transition-all ${form.appIcon === n ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                        <AppIcon name={n} size={13} />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Theme</label>
                  <div className="grid grid-cols-7 gap-1.5">
                    {APP_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setForm(f => ({ ...f, appColor: c }))}
                        className={`h-7 rounded-lg bg-gradient-to-br ${c} ${form.appColor === c ? 'ring-2 ring-offset-1 ring-slate-900' : ''}`} />
                    ))}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-2 flex items-center gap-2">
                  <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${form.appColor} flex items-center justify-center text-white`}>
                    <AppIcon name={form.appIcon} size={16} />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-slate-800">{form.name || 'App Name'}</p>
                    <p className="text-[12px] text-slate-400">Preview tile</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-white hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-base transition-all">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white font-semibold py-2.5 rounded-xl text-base transition-all disabled:opacity-60 flex items-center justify-center gap-1.5">
            {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Check size={14} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Inline display of the API key. The full key is stored encrypted at
 *  rest (AES-256-GCM via SHA-256(JWT_SECRET)) so we can decrypt it for
 *  authorised admins. Eye toggles visibility, copy copies the full key.
 *  Older connections created before encryption was rolled out won't have
 *  a value here — admin needs to rotate to issue one. */
function ApiKeyDisplay({ apiKey, prefix }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasFullKey = !!apiKey;

  const copy = () => {
    const text = hasFullKey ? apiKey : prefix;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success(hasFullKey ? 'API key copied' : 'Prefix copied — rotate to get the full key.');
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const masked = '••••••••••••••••••••••••••••••••';
  return (
    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mt-2">
      <code className="flex-1 text-sm text-slate-500 font-mono truncate">
        {hasFullKey
          ? (show ? apiKey : masked)
          : (prefix ? `${prefix}${masked.slice(prefix.length)}` : '—')}
      </code>
      {hasFullKey && (
        <button onClick={() => setShow(s => !s)}
          title={show ? 'Hide' : 'Reveal'}
          className="text-slate-500 hover:text-slate-800 transition-colors flex-shrink-0">
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      )}
      <button onClick={copy} disabled={!hasFullKey && !prefix}
        title={hasFullKey ? 'Copy key' : 'Copy prefix'}
        className="text-slate-500 hover:text-slate-800 transition-colors flex-shrink-0 disabled:opacity-40">
        {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
      </button>
      {!hasFullKey && (
        <span className="text-[12px] text-slate-400 flex-shrink-0 hidden sm:inline">rotate to get full key</span>
      )}
    </div>
  );
}

/** One-time reveal modal shown after create or rotate. The raw key is
 *  in memory only — once this modal closes, it's gone for good. */
function KeyRevealModal({ name, apiKey, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white px-6 py-5">
          <p className="text-[18px] font-bold">Save this key now</p>
          <p className="text-[14px] opacity-90 mt-1">This is the only time you'll see it. If you lose it, you'll need to rotate again — which will break your existing integration.</p>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[14px] text-slate-500">Connection: <strong className="text-slate-800">{name}</strong></p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-[13px] text-slate-800 break-all">
            {apiKey}
          </div>
          <button onClick={copy}
            className="w-full inline-flex items-center justify-center gap-2 bg-slate-900 text-white text-[15px] font-semibold px-4 py-2.5 rounded-lg hover:bg-slate-800">
            {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy to clipboard</>}
          </button>
          <p className="text-[13px] text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3">
            Paste this into your external app as the <code className="bg-white px-1 py-0.5 rounded">X-API-Key</code> header for calls to <code className="bg-white px-1 py-0.5 rounded">/api/external/access/check</code>.
          </p>
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-[15px] font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800">
            I've saved it
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessManager({ connection, onClose }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('all');
  const [saving, setSaving]   = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api-connections/${connection._id}/access`)
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed'))
      .finally(() => setLoading(false));
  }, [connection._id]);
  useEffect(() => { load(); }, [load]);

  const toggle = (employeeId, currentlyHas) => async () => {
    if (currentlyHas && !window.confirm('Revoke access for this employee? They will be blocked from logging in immediately.')) return;
    setSaving(true);
    try {
      if (currentlyHas) await api.delete(`/api-connections/${connection._id}/access/${employeeId}`);
      else              await api.post  (`/api-connections/${connection._id}/access`, { employeeIds: [employeeId] });
      setRows(rs => rs.map(r => r._id === employeeId ? { ...r, hasAccess: !currentlyHas } : r));
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const bulkGrant = async (ids) => {
    if (ids.length === 0) return;
    setSaving(true);
    try {
      await api.post(`/api-connections/${connection._id}/access`, { employeeIds: ids });
      toast.success(`Granted to ${ids.length} ${ids.length === 1 ? 'team_member' : 'employees'}`);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const bulkRevoke = async (ids) => {
    if (ids.length === 0) return;
    if (!window.confirm(`Revoke access for ${ids.length} ${ids.length === 1 ? 'team_member' : 'employees'}? They'll be blocked from logging in immediately.`)) return;
    setSaving(true);
    try {
      const r = await api.post(`/api-connections/${connection._id}/access/revoke`, { employeeIds: ids });
      toast.success(`Revoked access for ${r.data.revoked ?? ids.length}`);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows
      .filter(r => filter === 'all' || (filter === 'granted' ? r.hasAccess : !r.hasAccess))
      .filter(r => !q || `${r.firstName} ${r.lastName} ${r.email} ${r.employeeId} ${r.department || ''}`.toLowerCase().includes(q));
  }, [rows, search, filter]);

  const grantedCount = rows.filter(r => r.hasAccess).length;
  const visibleNotGranted = filtered.filter(r => !r.hasAccess);
  const visibleGranted    = filtered.filter(r =>  r.hasAccess);
  const color = connection.appColor || 'from-blue-500 to-indigo-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className={`bg-gradient-to-r ${color} text-white px-6 py-5 flex items-start justify-between`}>
          <div>
            <p className="text-[13px] uppercase tracking-wider font-bold opacity-90">Access Manager</p>
            <p className="text-[20px] font-bold mt-1 flex items-center gap-2">
              <AppIcon name={connection.appIcon || 'Layers'} size={20} /> {connection.name}
            </p>
            <p className="text-[14px] opacity-90 mt-1">{grantedCount} of {rows.length} employees have access</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center"><X size={14} /></button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px] flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3">
            <Search size={14} className="text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / ID / email / dept"
              className="flex-1 bg-transparent py-2 text-[15px] focus:outline-none ml-2" />
          </div>
          <div className="flex items-center gap-1">
            {[
              { v: 'all',         label: 'All'     },
              { v: 'granted',     label: 'Granted' },
              { v: 'not_granted', label: 'Pending' },
            ].map(f => (
              <button key={f.v} onClick={() => setFilter(f.v)}
                className={`px-3 py-1.5 text-[14px] font-semibold rounded-lg ${filter === f.v ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                {f.label}
              </button>
            ))}
          </div>
          {visibleNotGranted.length > 0 && (
            <button onClick={() => bulkGrant(visibleNotGranted.map(r => r._id))} disabled={saving}
              className="px-3 py-1.5 text-[14px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
              Grant {visibleNotGranted.length} shown
            </button>
          )}
          {visibleGranted.length > 0 && (
            <button onClick={() => bulkRevoke(visibleGranted.map(r => r._id))} disabled={saving}
              className="px-3 py-1.5 text-[14px] font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-60">
              Revoke {visibleGranted.length} shown
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-10 text-center text-slate-400">Loading employees…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-slate-400">No employees match.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map(r => (
                <li key={r._id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[14px] font-bold text-slate-700 flex-shrink-0">
                      {(r.firstName?.[0] || '') + (r.lastName?.[0] || '')}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-bold text-slate-800 truncate">{r.firstName} {r.lastName}</p>
                      <p className="text-[13px] text-slate-500 truncate">{r.employeeId} · {r.department || '—'} · {r.email}</p>
                    </div>
                  </div>
                  <button onClick={toggle(r._id, r.hasAccess)} disabled={saving}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-semibold transition-all flex-shrink-0 ${
                      r.hasAccess ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                    {r.hasAccess ? <><Check size={13} /> Granted</> : 'Grant'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ApiConnections() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [accessTarget, setAccessTarget] = useState(null);
  const [revealKey, setRevealKey] = useState(null); // { name, apiKey }

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api-connections');
      setConnections(res.data.data);
    } catch (err) {
      toast.error('Failed to load connections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const deleteConnection = async (id, name) => {
    if (!confirm(`Delete connection "${name}"?`)) return;
    try {
      await api.delete(`/api-connections/${id}`);
      toast.success('Connection deleted');
      fetchConnections();
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  const regenerateKey = async (id, name) => {
    if (!confirm(`Regenerate API key for "${name}"? The old key will stop working immediately.`)) return;
    try {
      const r = await api.post(`/api-connections/${id}/regenerate-key`);
      const apiKey = r.data?.data?.apiKey;
      if (apiKey) setRevealKey({ name, apiKey });
      toast.success('API key regenerated');
      fetchConnections();
    } catch (err) {
      toast.error('Failed to regenerate key');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-slate-800 text-3xl">API Connections</h1>
          <p className="text-slate-500 text-base mt-1">Connect external websites to sync data into the unified database.</p>
        </div>
        <button onClick={() => { setEditTarget(null); setModalOpen(true); }} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold px-4 py-2.5 rounded-xl text-base transition-all shadow-lg shadow-brand-500/20">
          <Plus size={15} /> New Connection
        </button>
      </div>

      {/* How it works */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-2xl p-5 mb-6">
        <div className="flex items-start gap-3">
          <Zap size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-slate-800 text-base font-semibold">How to connect an external website</p>
            <p className="text-slate-600 text-[14px] leading-relaxed">
              Create a connection, then copy the API key from the card. Every call from your external website
              must include the header{' '}
              <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-[13px]">x-api-key: your-key</code>.
            </p>
            <p className="text-slate-600 text-[14px] leading-relaxed">
              <strong className="text-slate-800">For user-facing apps</strong> (LMS, User Report, etc.) — verify each login by calling{' '}
              <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-[13px]">POST /api/external/access/check</code>{' '}
              with <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-[13px]">{'{ email }'}</code>.
              Returns <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-[13px]">{'{ allowed, employee }'}</code>.
            </p>
            <p className="text-slate-600 text-[14px] leading-relaxed">
              <strong className="text-slate-800">For data-sync integrations</strong> — push employee data to{' '}
              <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-[13px]">POST /api/external/employees</code>.
              Health check at{' '}
              <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-[13px]">GET /api/external/status</code>.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white shadow-sm border border-slate-200 rounded-2xl">
          <Globe size={40} className="text-slate-600 mb-3" />
          <p className="text-slate-500 text-base mb-1">No connections yet.</p>
          <p className="text-slate-600 text-sm">Create your first API connection to start syncing data.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {connections.map(conn => (
            <div key={conn._id} className="bg-white shadow-sm border border-slate-200 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${conn.isActive ? 'bg-brand-600/20 border-brand-600/30' : 'bg-slate-100 border-slate-200'}`}>
                    <Globe size={18} className={conn.isActive ? 'text-brand-400' : 'text-slate-500'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-slate-800 font-semibold text-base">{conn.name}</p>
                      <span className={`text-sm px-2 py-0.5 rounded-full border font-medium ${conn.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {conn.isActive ? 'Active' : 'Inactive'}
                      </span>
                      {conn.company && <span className="text-sm text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{conn.company}</span>}
                    </div>
                    {conn.websiteUrl && <p className="text-slate-500 text-sm mt-0.5">{conn.websiteUrl}</p>}
                    {conn.description && <p className="text-slate-500 text-sm mt-1">{conn.description}</p>}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(conn.allowedDataTypes || []).map(type => (
                        <span key={type} className="text-sm bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200">{type}</span>
                      ))}
                    </div>
                    {conn.lastSyncAt && (
                      <p className="text-slate-600 text-sm mt-2">Last sync: {new Date(conn.lastSyncAt).toLocaleString()}</p>
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-500 mt-3 mb-0.5">API Key</p>
                      <ApiKeyDisplay apiKey={conn.apiKey} prefix={conn.apiKeyPrefix} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {conn.isUserApp && (
                    <button onClick={() => setAccessTarget(conn)} title="Manage user access"
                      className="inline-flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[14px] font-semibold px-2.5 py-1.5 rounded-lg mr-1">
                      <Users size={13} /> Access
                    </button>
                  )}
                  <button onClick={() => regenerateKey(conn._id, conn.name)} title="Regenerate API key" className="text-slate-500 hover:text-amber-400 p-2 rounded-lg hover:bg-slate-100 transition-all">
                    <RefreshCw size={14} />
                  </button>
                  <button onClick={() => { setEditTarget(conn); setModalOpen(true); }} className="text-slate-500 hover:text-brand-400 p-2 rounded-lg hover:bg-slate-100 transition-all">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => deleteConnection(conn._id, conn.name)} className="text-slate-500 hover:text-red-400 p-2 rounded-lg hover:bg-slate-100 transition-all">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <ConnectionModal
          connection={editTarget}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
          onSaved={(created) => {
            setModalOpen(false);
            setEditTarget(null);
            fetchConnections();
            // `created` is { name, apiKey } only when a brand-new connection was made.
            if (created?.apiKey) setRevealKey(created);
          }}
        />
      )}

      {accessTarget && (
        <AccessManager connection={accessTarget} onClose={() => setAccessTarget(null)} />
      )}

      {revealKey && (
        <KeyRevealModal name={revealKey.name} apiKey={revealKey.apiKey} onClose={() => setRevealKey(null)} />
      )}
    </div>
  );
}
