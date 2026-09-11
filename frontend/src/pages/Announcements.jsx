import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Megaphone, Plus, Trash2, Pin, PinOff, X, AlertTriangle, Info, Calendar,
  MoreHorizontal, Pencil, Link2, Bold, Italic, Underline, Strikethrough,
  List, ListOrdered,
} from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useFunctionAccess } from '../context/FunctionAccessContext';
import { isFullAccess } from '../utils/roles';
import { PhotoAvatar } from '../components/ui';
import AnnouncementDetailModal from '../components/AnnouncementDetailModal';
import { renderRichText } from '../utils/richText';

const TYPE_CONFIG = {
  general: { label: 'General', icon: Megaphone,     badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  urgent:  { label: 'Urgent',  icon: AlertTriangle, badge: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300' },
  info:    { label: 'Info',    icon: Info,          badge: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300' },
  event:   { label: 'Event',   icon: Calendar,      badge: 'bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300' },
};

const EMPTY_FORM = { title: '', body: '', type: 'general', isPinned: false, pinnedUntil: '', expiresAt: '' };

const dmy = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 30) return dmy(dateStr);
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hrs > 0) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  if (mins > 0) return `${mins} min ago`;
  return 'Just now';
}

/* Wraps the selection in the textarea rather than swapping in a
 * contenteditable — the stored value has to stay plain text, see
 * utils/richText. */
function RichTextArea({ value, onChange }) {
  const ref = useRef(null);

  const wrap = (before, after = before) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = value.slice(s, e) || 'text';
    const next = `${value.slice(0, s)}${before}${selected}${after}${value.slice(e)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + selected.length);
    });
  };

  const prefixLines = (marker) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const start = value.lastIndexOf('\n', s - 1) + 1;
    const end = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
    const block = value.slice(start, end) || 'item';
    const numbered = marker === '1. ';
    const lines = block.split('\n').map((l, i) => `${numbered ? `${i + 1}. ` : marker}${l}`);
    const next = `${value.slice(0, start)}${lines.join('\n')}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => el.focus());
  };

  const TOOLS = [
    { icon: Bold,          title: 'Bold',      run: () => wrap('**') },
    { icon: Italic,        title: 'Italic',    run: () => wrap('*') },
    { icon: Underline,     title: 'Underline', run: () => wrap('__') },
    { icon: Strikethrough, title: 'Strike',    run: () => wrap('~~') },
    { icon: List,          title: 'Bulleted list', run: () => prefixLines('- ') },
    { icon: ListOrdered,   title: 'Numbered list', run: () => prefixLines('1. ') },
    { icon: Link2,         title: 'Link',      run: () => wrap('[', '](https://)') },
  ];

  return (
    <div className="border border-slate-200 dark:border-[#374151] rounded-xl overflow-hidden focus-within:border-brand-400">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        rows={7}
        placeholder="Write your announcement..."
        className="w-full px-3 py-2.5 text-base bg-transparent text-slate-800 dark:text-slate-100 focus:outline-none resize-y"
      />
      <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-t border-slate-200 dark:border-[#374151] bg-slate-50 dark:bg-[#111827]">
        {TOOLS.map(({ icon: Icon, title, run }) => (
          <button key={title} type="button" title={title} onClick={run}
            className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#374151] hover:text-slate-800 dark:hover:text-slate-100 transition-colors">
            <Icon size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}

function RowMenu({ a, canManage, onEdit, onTogglePin, onDelete, onCopyLink }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const items = [
    { label: 'Copy post link', icon: Link2, run: onCopyLink },
    ...(canManage ? [
      { label: 'Edit', icon: Pencil, run: onEdit },
      { label: a.isPinned ? 'Unpin' : 'Pin to top', icon: a.isPinned ? PinOff : Pin, run: onTogglePin },
      { label: 'Delete', icon: Trash2, run: onDelete, danger: true },
    ] : []),
  ];

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen(v => !v)} title="More"
        className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-[#1f2937] border border-slate-100 dark:border-[#374151] rounded-xl shadow-xl z-20 py-1 overflow-hidden">
          {items.map(({ label, icon: Icon, run, danger }) => (
            <button key={label} type="button"
              onClick={() => { setOpen(false); run(); }}
              className={`w-full text-left px-3 py-2 text-[14px] flex items-center gap-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-[#374151] ${
                danger ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'
              }`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Announcements() {
  const { user } = useAuth();
  /* Add / Edit / Delete is the sub-control beside Announcements under Function
   * Based Permissions. It narrows the existing role guard and never widens it,
   * so both have to pass. The API enforces the same pair. */
  const { can, optionOf } = useFunctionAccess();
  const canManage = isFullAccess(user) && can('announcements') && !!optionOf('announcements').manage;
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [reading, setReading] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/announcements').then(r => setAnnouncements(r.data.data || [])).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setModal(true); };

  const openEdit = (a) => {
    setEditing(a);
    setForm({
      title: a.title || '',
      body: a.body || '',
      type: a.type || 'general',
      isPinned: !!a.isPinned,
      pinnedUntil: a.pinnedUntil ? String(a.pinnedUntil).slice(0, 10) : '',
      expiresAt: a.expiresAt ? String(a.expiresAt).slice(0, 10) : '',
    });
    setModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      // Both dates are always sent, including as null — the API treats a key
      // that is present as "set it to exactly this", which is what makes
      // clearing a date possible at all.
      const payload = {
        ...form,
        pinnedUntil: form.isPinned && form.pinnedUntil ? form.pinnedUntil : null,
        expiresAt: form.expiresAt || null,
      };
      if (editing) {
        await api.put(`/announcements/${editing._id}`, payload);
        toast.success('Announcement updated');
      } else {
        await api.post('/announcements', payload);
        toast.success('Announcement posted!');
      }
      setModal(false); setEditing(null); setForm(EMPTY_FORM);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    setBusyId(id);
    try { await api.delete(`/announcements/${id}`); toast.success('Deleted'); load(); }
    catch { toast.error('Failed to delete'); }
    finally { setBusyId(null); }
  };

  const handleTogglePin = async (a) => {
    setBusyId(a._id);
    try {
      await api.put(`/announcements/${a._id}`, {
        isPinned: !a.isPinned,
        pinnedUntil: a.isPinned ? null : a.pinnedUntil || null,
      });
      toast.success(a.isPinned ? 'Unpinned' : 'Pinned');
      load();
    } catch { toast.error('Failed to update'); }
    finally { setBusyId(null); }
  };

  const copyLink = async (a) => {
    const url = `${window.location.origin}/announcements#${a._id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      // Clipboard is blocked without https or a user-gesture in some browsers.
      toast.error(url);
    }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-slate-800 dark:text-slate-100 text-xl">Announcements</h2>
          <p className="text-slate-400 text-base mt-0.5">Company-wide notices and updates</p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Plus size={16} /> New Announcement
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : announcements.length === 0 ? (
        <div className="bg-white dark:bg-[#1f2937] rounded-2xl border border-slate-100 dark:border-[#374151] shadow-sm text-center py-20">
          <Megaphone size={40} className="text-slate-200 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No announcements yet</p>
          {canManage && <p className="text-slate-300 dark:text-slate-500 text-base mt-1">Post an announcement to notify all employees</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map(a => {
            const cfg = TYPE_CONFIG[a.type] || TYPE_CONFIG.general;
            const poster = a.postedBy || {};
            return (
              <div key={a._id} id={a._id}
                className={`bg-white dark:bg-[#1f2937] rounded-2xl border shadow-sm transition-shadow hover:shadow-md ${
                  a.isPinned ? 'border-brand-200 dark:border-brand-500/40' : 'border-slate-100 dark:border-[#374151]'
                }`}>
                <div className="flex items-start gap-3 p-4">
                  <PhotoAvatar photoUrl={poster.photoUrl} firstName={poster.firstName} lastName={poster.lastName}
                               className="w-10 h-10" textClassName="text-xs" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-slate-800 dark:text-slate-100">
                        {poster.firstName} {poster.lastName}
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="text-[13px] text-slate-400">{timeAgo(a.createdAt)}</span>
                      <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                      {a.isPinned && (
                        <span className="text-[11px] font-bold text-brand-600 dark:text-brand-400 flex items-center gap-1">
                          <Pin size={10} /> Pinned
                        </span>
                      )}
                    </div>

                    <button type="button" onClick={() => setReading(a)}
                      className="block text-left mt-1.5 font-display font-bold text-[17px] text-slate-800 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
                      {a.title}
                    </button>

                    <div
                      className="mt-1 text-[14px] leading-relaxed text-slate-600 dark:text-slate-300 line-clamp-3 [&_a]:text-brand-600"
                      dangerouslySetInnerHTML={{ __html: renderRichText(a.body) }}
                    />

                    <div className="flex items-center gap-3 mt-2.5 text-[12px] text-slate-400 flex-wrap">
                      <button type="button" onClick={() => setReading(a)} className="text-brand-600 dark:text-brand-400 font-medium hover:underline">
                        Read more
                      </button>
                      <span>Expiry: {a.expiresAt ? dmy(a.expiresAt) : 'Nil'}</span>
                      {a.isPinned && a.pinnedUntil && <span>Pin expires {dmy(a.pinnedUntil)}</span>}
                    </div>
                  </div>

                  <RowMenu
                    a={a}
                    canManage={canManage && busyId !== a._id}
                    onEdit={() => openEdit(a)}
                    onTogglePin={() => handleTogglePin(a)}
                    onDelete={() => handleDelete(a._id)}
                    onCopyLink={() => copyLink(a)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {reading && <AnnouncementDetailModal announcement={reading} onClose={() => setReading(null)} />}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1f2937] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-[#374151]">
              <h3 className="font-display font-semibold text-slate-800 dark:text-slate-100 text-xl">
                {editing ? 'Edit Announcement' : 'Post Announcement'}
              </h3>
              <button onClick={() => { setModal(false); setEditing(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-[#374151] hover:bg-slate-200 text-slate-600 dark:text-slate-300"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Title *</label>
                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required
                  placeholder="Announcement title..." className="w-full border border-slate-200 dark:border-[#374151] bg-transparent text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Message *</label>
                <RichTextArea value={form.body} onChange={body => setForm({ ...form, body })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Type</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                    className="w-full border border-slate-200 dark:border-[#374151] bg-transparent text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400">
                    {Object.entries(TYPE_CONFIG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                    Expires on <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input type="date" value={form.expiresAt} min={new Date().toISOString().slice(0, 10)}
                    onChange={e => setForm({ ...form, expiresAt: e.target.value })}
                    className="w-full border border-slate-200 dark:border-[#374151] bg-transparent text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
                </div>
              </div>
              <p className="text-[13px] text-slate-400 -mt-2">
                After the expiry date the announcement stops appearing for everyone. Leave blank to keep it indefinitely.
              </p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.isPinned}
                  onChange={e => setForm({ ...form, isPinned: e.target.checked, pinnedUntil: e.target.checked ? form.pinnedUntil : '' })}
                  className="w-4 h-4 accent-brand-600" />
                <span>
                  <span className="block text-base font-medium text-slate-700 dark:text-slate-200">Pin to top</span>
                  <span className="block text-sm text-slate-400">Show above others</span>
                </span>
              </label>
              {form.isPinned && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                    Keep pinned until <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="date"
                    value={form.pinnedUntil}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={e => setForm({ ...form, pinnedUntil: e.target.value })}
                    className="w-full border border-slate-200 dark:border-[#374151] bg-transparent text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"
                  />
                  <p className="text-[13px] text-slate-400 mt-1">
                    Leave blank to pin indefinitely. The pin badge disappears automatically once this date passes — the announcement itself stays visible.
                  </p>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setModal(false); setEditing(null); }} className="flex-1 border border-slate-200 dark:border-[#374151] text-slate-600 dark:text-slate-300 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50 dark:hover:bg-[#374151]">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60">
                  {saving ? 'Saving...' : editing ? 'Save changes' : 'Post Announcement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
