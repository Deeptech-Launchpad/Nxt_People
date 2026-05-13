import React, { useState, useEffect } from 'react';
import {
  Plus, Search, Briefcase, Users, CheckSquare, Clock,
  X, ChevronRight, Loader2, FolderOpen,
  Calendar, AlignLeft
} from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ── Status config ────────────────────────────────────────────── */
const STATUS = {
  active:    { label: 'Active',    bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  completed: { label: 'Completed', bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500'    },
  on_hold:   { label: 'On Hold',   bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
  cancelled: { label: 'Cancelled', bg: 'bg-rose-100',    text: 'text-rose-600',    dot: 'bg-rose-400'    },
};

const COLORS = [
  '#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899',
];

const StatusBadge = ({ status }) => {
  const s = STATUS[status] || STATUS.active;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

/* ── New Project Modal ────────────────────────────────────────── */
function ProjectModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', description: '', status: 'active', priority: 'medium', dueDate: '',
  });
  const [saving, setSaving] = useState(false);

  const handle = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Project name is required');
    setSaving(true);
    try {
      await api.post('/projects', {
        name: form.name.trim(),
        description: form.description.trim() || null,
        status: form.status,
        priority: form.priority,
        dueDate: form.dueDate || null,
      });
      toast.success('Project created!');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create project');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Briefcase size={15} className="text-blue-600" />
            </div>
            <h2 className="text-[15px] font-bold text-slate-800">New Project</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Project Name <span className="text-rose-500">*</span>
            </label>
            <input
              value={form.name} onChange={e => handle('name', e.target.value)}
              placeholder="e.g. Website Redesign"
              className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              <AlignLeft size={11} className="inline mr-1" /> Description
            </label>
            <textarea
              value={form.description} onChange={e => handle('description', e.target.value)}
              placeholder="Brief description of the project…"
              rows={3}
              className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none"
            />
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Status</label>
              <select value={form.status} onChange={e => handle('status', e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white">
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Priority</label>
              <select value={form.priority} onChange={e => handle('priority', e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              <Calendar size={11} className="inline mr-1" /> Due Date
            </label>
            <input type="date" value={form.dueDate} onChange={e => handle('dueDate', e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400" />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Project Card ─────────────────────────────────────────────── */
function ProjectCard({ project, onView }) {
  const s = STATUS[project.status] || STATUS.active;
  const color = project.color || COLORS[0];
  const initials = project.name?.slice(0, 2).toUpperCase() || 'PR';
  const progress = project.estimatedHours > 0
    ? Math.min(100, Math.round(((project.loggedHours || 0) / project.estimatedHours) * 100))
    : 0;

  return (
    <div
      onClick={() => onView(project)}
      className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group overflow-hidden"
    >
      {/* Color top bar */}
      <div className="h-1.5 w-full" style={{ background: color }} />

      <div className="p-5">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0 shadow-sm"
              style={{ background: color }}>
              {initials}
            </div>
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-bold text-slate-800 truncate group-hover:text-blue-600 transition-colors">
                {project.name}
              </h3>
              {project.description && (
                <p className="text-[11.5px] text-slate-400 truncate mt-0.5">{project.description}</p>
              )}
            </div>
          </div>
          <StatusBadge status={project.status} />
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-[11.5px] text-slate-500 mb-4">
          <span className="flex items-center gap-1">
            <Users size={11} className="text-slate-400" />
            {project.memberCount || 0} member{project.memberCount !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1">
            <CheckSquare size={11} className="text-slate-400" />
            {project.taskCount || 0} tasks
          </span>
          {project.estimatedHours > 0 && (
            <span className="flex items-center gap-1">
              <Clock size={11} className="text-slate-400" />
              {project.loggedHours || 0}/{project.estimatedHours}h
            </span>
          )}
        </div>

        {/* Progress bar */}
        {project.estimatedHours > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10.5px] text-slate-400 font-medium">Progress</span>
              <span className="text-[10.5px] font-bold text-slate-600">{progress}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progress}%`, background: color }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────── */
export default function TimeTrackerProjects() {
  const [projects, setProjects]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filterStatus, setFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/projects').then(r => setProjects(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = projects.filter(p => {
    const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: projects.length,
    active: projects.filter(p => p.status === 'active').length,
    completed: projects.filter(p => p.status === 'completed').length,
    onHold: projects.filter(p => p.status === 'on_hold').length,
  };

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      {/* Stats banner */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Projects', val: stats.total,     color: 'text-slate-700',   icon: Briefcase  },
          { label: 'Active',         val: stats.active,    color: 'text-emerald-600', icon: CheckSquare},
          { label: 'Completed',      val: stats.completed, color: 'text-blue-600',    icon: CheckSquare},
          { label: 'On Hold',        val: stats.onHold,    color: 'text-amber-600',   icon: Clock      },
        ].map(({ label, val, color, icon: Icon }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center ${color}`}>
              <Icon size={18} />
            </div>
            <div>
              <p className={`text-[22px] font-bold leading-none ${color}`}>{val}</p>
              <p className="text-[11px] text-slate-400 mt-1 font-medium">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="w-full pl-9 pr-4 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white"
          />
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
          {[['all','All'],['active','Active'],['completed','Done'],['on_hold','On Hold']].map(([k,l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-all ${filterStatus === k ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {l}
            </button>
          ))}
        </div>

        <button onClick={() => setShowModal(true)}
          className="ml-auto flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm">
          <Plus size={14} /> New Project
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="text-blue-500 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
            <FolderOpen size={28} className="text-slate-300" />
          </div>
          <p className="text-[14px] font-semibold text-slate-500">
            {search ? 'No projects match your search' : 'No projects yet'}
          </p>
          <p className="text-[12.5px] text-slate-400 mt-1">
            {search ? 'Try a different keyword' : 'Click "New Project" to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => (
            <ProjectCard key={p._id} project={p} onView={() => {}} />
          ))}
        </div>
      )}

      {showModal && (
        <ProjectModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}
    </div>
  );
}
