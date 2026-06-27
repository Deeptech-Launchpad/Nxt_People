import React, { useState, useEffect, useCallback } from 'react';
import { Megaphone, Plus, Trash2, Pin, X, AlertTriangle, Info, Calendar, Bell } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { isFullAccess } from '../utils/roles';

const TYPE_CONFIG = {
  general: { label: 'General', icon: Megaphone, bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', badge: 'bg-slate-100 text-slate-600' },
  urgent: { label: 'Urgent', icon: AlertTriangle, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-600' },
  info: { label: 'Info', icon: Info, bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-600' },
  event: { label: 'Event', icon: Calendar, bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-600' },
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hrs > 0) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  if (mins > 0) return `${mins} min ago`;
  return 'Just now';
}

export default function Announcements() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', type: 'general', isPinned: false, pinnedUntil: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/announcements').then(r => setAnnouncements(r.data.data || [])).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const handleCreate = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      // pinnedUntil only travels to the server when the announcement is
      // actually pinned AND HR chose a date. Empty string → null → "pin forever".
      const payload = {
        ...form,
        pinnedUntil: form.isPinned && form.pinnedUntil ? form.pinnedUntil : null,
      };
      await api.post('/announcements', payload);
      toast.success('Announcement posted!');
      setModal(false); setForm({ title: '', body: '', type: 'general', isPinned: false, pinnedUntil: '' });
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    try { await api.delete(`/announcements/${id}`); toast.success('Deleted'); load(); }
    catch (err) { toast.error('Failed to delete'); }
  };

  // Toggle the pin badge on an existing announcement. Unpinning leaves the
  // announcement visible on this page but removes it from the dashboard feed.
  const handleTogglePin = async (a) => {
    try {
      await api.put(`/announcements/${a._id}`, {
        isPinned: !a.isPinned,
        // Clearing pinnedUntil when unpinning prevents the auto-unpin cron
        // from re-firing on an already-unpinned row.
        pinnedUntil: a.isPinned ? null : a.pinnedUntil || null,
      });
      toast.success(a.isPinned ? 'Unpinned' : 'Pinned');
      load();
    } catch (err) {
      toast.error('Failed to update');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-slate-800 text-xl">Announcements</h2>
          <p className="text-slate-400 text-base mt-0.5">Company-wide notices and updates</p>
        </div>
        {isFullAccess(user) && (
          <button onClick={() => setModal(true)} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Plus size={16} /> New Announcement
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : announcements.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm text-center py-20">
          <Megaphone size={40} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No announcements yet</p>
          {isFullAccess(user) && <p className="text-slate-300 text-base mt-1">Post an announcement to notify all employees</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {announcements.map(a => {
            const cfg = TYPE_CONFIG[a.type] || TYPE_CONFIG.general;
            const Icon = cfg.icon;
            return (
              <div key={a._id} className={`rounded-2xl border p-5 ${cfg.bg} ${cfg.border} relative overflow-hidden`}>
                {a.isPinned && (
                  <div className="absolute top-0 right-0">
                    {isFullAccess(user) ? (
                      <button
                        type="button"
                        onClick={() => handleTogglePin(a)}
                        title="Click to unpin"
                        className="bg-brand-500 hover:bg-brand-600 text-white text-[12px] font-bold px-3 py-1 rounded-bl-xl flex items-center gap-1 transition-colors"
                      >
                        <Pin size={10} /> Pinned
                      </button>
                    ) : (
                      <div className="bg-brand-500 text-white text-[12px] font-bold px-3 py-1 rounded-bl-xl flex items-center gap-1">
                        <Pin size={10} /> Pinned
                      </div>
                    )}
                  </div>
                )}
                {!a.isPinned && isFullAccess(user) && (
                  <div className="absolute top-0 right-0">
                    <button
                      type="button"
                      onClick={() => handleTogglePin(a)}
                      title="Click to pin"
                      className="bg-slate-100 hover:bg-brand-50 text-slate-500 hover:text-brand-600 text-[12px] font-bold px-3 py-1 rounded-bl-xl flex items-center gap-1 transition-colors"
                    >
                      <Pin size={10} /> Pin
                    </button>
                  </div>
                )}
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-white/60`}>
                    <Icon size={18} className={cfg.text} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className={`font-display font-bold text-lg ${cfg.text}`}>{a.title}</h3>
                      <span className={`text-[12px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                    </div>
                    <p className={`text-base leading-relaxed ${cfg.text} opacity-80`}>{a.body}</p>
                    <div className="flex items-center gap-3 mt-3 text-sm opacity-60 flex-wrap">
                      <span>Posted by {a.postedBy?.firstName} {a.postedBy?.lastName}</span>
                      <span>·</span>
                      <span>{timeAgo(a.createdAt)}</span>
                      {a.isPinned && a.pinnedUntil && (
                        <>
                          <span>·</span>
                          <span>
                            Pin expires {new Date(a.pinnedUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {isFullAccess(user) && (
                    <button onClick={() => handleDelete(a._id)} className="flex-shrink-0 p-2 rounded-lg hover:bg-black/5 transition-colors text-slate-500 hover:text-red-500">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-xl">Post Announcement</h3>
              <button onClick={() => setModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Title *</label>
                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required
                  placeholder="Announcement title..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Message *</label>
                <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} required rows={4}
                  placeholder="Write your announcement..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">Type</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400">
                    {Object.entries(TYPE_CONFIG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center">
                  <label className="flex items-center gap-3 cursor-pointer mt-5">
                    <input type="checkbox" checked={form.isPinned}
                      onChange={e => setForm({ ...form, isPinned: e.target.checked, pinnedUntil: e.target.checked ? form.pinnedUntil : '' })}
                      className="w-4 h-4 accent-brand-600" />
                    <div>
                      <p className="text-base font-medium text-slate-700">Pin to top</p>
                      <p className="text-sm text-slate-400">Show above others</p>
                    </div>
                  </label>
                </div>
              </div>
              {form.isPinned && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">
                    Keep pinned until <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="date"
                    value={form.pinnedUntil}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={e => setForm({ ...form, pinnedUntil: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"
                  />
                  <p className="text-[13px] text-slate-400 mt-1">
                    Leave blank to pin indefinitely. The pin badge disappears automatically once this date passes — the announcement itself stays visible.
                  </p>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60">
                  {saving ? 'Posting...' : 'Post Announcement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
