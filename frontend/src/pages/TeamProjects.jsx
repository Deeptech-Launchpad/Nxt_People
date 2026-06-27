import React, { useState, useEffect } from 'react';
import {
  Briefcase, Users, CheckSquare, Clock, Plus, Search,
  X, ChevronRight, Loader2, FolderOpen, BarChart2,
  CheckCircle2, Circle, AlertCircle, Tag, Calendar,
  User, MessageSquare, Paperclip, AlignLeft, ArrowLeft
} from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

/* ── Helpers ──────────────────────────────────────────────────── */
const STATUS_CONFIG = {
  active:    { label: 'Active',    bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  completed: { label: 'Completed', bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500'    },
  on_hold:   { label: 'On Hold',   bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
  cancelled: { label: 'Cancelled', bg: 'bg-rose-100',    text: 'text-rose-600',    dot: 'bg-rose-400'    },
};
const TASK_STATUS = {
  todo:        { label: 'To Do',       icon: Circle,        color: 'text-slate-400'  },
  in_progress: { label: 'In Progress', icon: AlertCircle,   color: 'text-blue-500'   },
  done:        { label: 'Done',        icon: CheckCircle2,  color: 'text-emerald-500'},
};
const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316'];

const StatusBadge = ({ status }) => {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG.active;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

const Avatar = ({ name = '', size = 7 }) => {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
  return (
    <div className={`w-${size} h-${size} rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>
      {initials || '?'}
    </div>
  );
};

/* ── Project Detail Drawer ────────────────────────────────────── */
function ProjectDrawer({ project, onClose, onRefresh }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab]   = useState('tasks');
  const [tasks, setTasks]           = useState([]);
  const [members, setMembers]       = useState([]);
  const [loadingTasks, setLT]       = useState(true);
  const [newTask, setNewTask]       = useState('');
  const [addingTask, setAddingTask] = useState(false);

  const color = project.color || COLORS[0];

  const loadDetail = () => {
    setLT(true);
    api.get(`/projects/${project._id}`)
      .then(r => {
        setMembers(r.data.data?.members || []);
        setTasks(r.data.data?.tasks || []);
      })
      .catch(() => {})
      .finally(() => setLT(false));
  };

  useEffect(() => { loadDetail(); }, [project._id]);

  const addTask = async () => {
    if (!newTask.trim()) return;
    setAddingTask(true);
    try {
      const r = await api.post('/tasks', { title: newTask.trim(), projectId: project._id, status: 'todo' });
      setTasks(t => [r.data.data, ...t]);
      setNewTask('');
    } catch { toast.error('Failed to add task'); }
    finally { setAddingTask(false); }
  };

  const toggleTask = async (task) => {
    const next = task.status === 'done' ? 'todo' : 'done';
    setTasks(ts => ts.map(t => t._id === task._id ? { ...t, status: next } : t));
    try {
      await api.put(`/tasks/${task._id}`, { status: next });
    } catch {
      toast.error('Failed to update task');
      setTasks(ts => ts.map(t => t._id === task._id ? { ...t, status: task.status } : t));
    }
  };

  const progress = tasks.length > 0 ? Math.round((tasks.filter(t => t.status === 'done').length / tasks.length) * 100) : 0;

  const TABS = [
    { key: 'tasks',       label: 'Tasks',       icon: CheckSquare, count: tasks.length },
    { key: 'members',     label: 'Members',     icon: Users,       count: members.length },
    { key: 'performance', label: 'Performance', icon: BarChart2,   count: null },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Color bar */}
        <div className="h-1.5 w-full flex-shrink-0" style={{ background: color }} />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0"
              style={{ background: color }}>
              {project.name?.slice(0,2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-800 truncate">{project.name}</h2>
              <StatusBadge status={project.status} />
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Description */}
        {project.description && (
          <div className="px-6 py-3 border-b border-slate-50 bg-slate-50/70 flex-shrink-0">
            <p className="text-[12.5px] text-slate-500 leading-relaxed">{project.description}</p>
          </div>
        )}

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-slate-100 flex-shrink-0">
          {[
            { label: 'Tasks Done', val: `${tasks.filter(t=>t.status==='done').length}/${tasks.length}`, icon: CheckSquare, color: 'text-emerald-600' },
            { label: 'Members',    val: members.length, icon: Users, color: 'text-blue-600' },
            { label: 'Est. Hours', val: project.estimatedHours ? `${project.estimatedHours}h` : '—', icon: Clock, color: 'text-amber-600' },
          ].map(({ label, val, icon: Icon, color: c }) => (
            <div key={label} className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
              <Icon size={14} className={`${c} mx-auto mb-1`} />
              <p className={`text-[15px] font-bold ${c}`}>{val}</p>
              <p className="text-[10.5px] text-slate-400 font-medium">{label}</p>
            </div>
          ))}
        </div>

        {/* Progress */}
        {tasks.length > 0 && (
          <div className="px-6 py-3 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11.5px] font-semibold text-slate-500">Overall Progress</span>
              <span className="text-[11.5px] font-bold text-slate-700">{progress}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progress}%`, background: color }} />
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-6 border-b border-slate-100 flex-shrink-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 py-3 px-2 text-[12.5px] font-medium border-b-2 transition-all whitespace-nowrap
                ${activeTab === t.key ? 'border-blue-500 text-blue-600 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <t.icon size={12} />
              {t.label}
              {t.count !== null && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === t.key ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">

          {/* TASKS TAB */}
          {activeTab === 'tasks' && (
            <div className="p-5 space-y-3">
              {/* Add task input */}
              <div className="flex items-center gap-2">
                <input
                  value={newTask} onChange={e => setNewTask(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTask()}
                  placeholder="Add a task and press Enter…"
                  className="flex-1 px-3 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <button onClick={addTask} disabled={addingTask || !newTask.trim()}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1">
                  {addingTask ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
                </button>
              </div>

              {loadingTasks ? (
                <div className="flex justify-center py-10">
                  <Loader2 size={22} className="animate-spin text-blue-500" />
                </div>
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <CheckSquare size={28} className="text-slate-200 mb-2" />
                  <p className="text-[13px] font-semibold text-slate-400">No tasks yet</p>
                  <p className="text-[12px] text-slate-300 mt-0.5">Add your first task above</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* In Progress */}
                  {tasks.filter(t => t.status !== 'done').length > 0 && (
                    <>
                      <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider px-1 mt-2">In Progress</p>
                      {tasks.filter(t => t.status !== 'done').map(task => (
                        <TaskRow key={task._id} task={task} onToggle={() => toggleTask(task)} />
                      ))}
                    </>
                  )}
                  {/* Done */}
                  {tasks.filter(t => t.status === 'done').length > 0 && (
                    <>
                      <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider px-1 mt-4">Completed</p>
                      {tasks.filter(t => t.status === 'done').map(task => (
                        <TaskRow key={task._id} task={task} onToggle={() => toggleTask(task)} done />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* MEMBERS TAB */}
          {activeTab === 'members' && (
            <div className="p-5">
              {members.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <Users size={28} className="text-slate-200 mb-2" />
                  <p className="text-[13px] font-semibold text-slate-400">No members assigned</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {members.map((m, i) => (
                    <div key={m._id || i} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100 hover:border-slate-200 transition-colors">
                      <Avatar name={`${m.firstName} ${m.lastName}`} size={9} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 truncate">{m.firstName} {m.lastName}</p>
                        <p className="text-[11.5px] text-slate-400 truncate">{m.designation || m.role || 'Member'}</p>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-semibold capitalize flex-shrink-0">
                        {m.role || 'member'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PERFORMANCE TAB */}
          {activeTab === 'performance' && (
            <div className="p-5 space-y-3">
              {[
                { label: 'Estimated Hours', val: project.estimatedHours ? `${project.estimatedHours}h` : '—', color: 'text-slate-700' },
                { label: 'Logged Hours',    val: `${project.loggedHours || 0}h`, color: 'text-blue-600' },
                { label: 'Completion',      val: `${progress}%`,  color: 'text-emerald-600' },
                { label: 'Total Tasks',     val: tasks.length,    color: 'text-slate-700' },
                { label: 'Completed Tasks', val: tasks.filter(t=>t.status==='done').length, color: 'text-emerald-600' },
                { label: 'Pending Tasks',   val: tasks.filter(t=>t.status!=='done').length, color: 'text-amber-600' },
              ].map(({ label, val, color: c }) => (
                <div key={label} className="flex items-center justify-between bg-slate-50 rounded-xl border border-slate-100 px-5 py-3">
                  <span className="text-[12.5px] text-slate-600 font-medium">{label}</span>
                  <span className={`text-[14px] font-bold ${c}`}>{val}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Task Row ─────────────────────────────────────────────────── */
function TaskRow({ task, onToggle, done }) {
  return (
    <div className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3 transition-colors group
      ${done ? 'border-slate-100 opacity-60' : 'border-slate-200 hover:border-blue-200 hover:bg-blue-50/30'}`}>
      <button onClick={onToggle} className="flex-shrink-0 transition-transform hover:scale-110">
        {done
          ? <CheckCircle2 size={17} className="text-emerald-500" />
          : <Circle size={17} className="text-slate-300 group-hover:text-blue-400" />
        }
      </button>
      <span className={`text-[12.5px] flex-1 ${done ? 'line-through text-slate-400' : 'text-slate-700 font-medium'}`}>
        {task.title}
      </span>
      {task.assignee && (
        <Avatar name={`${task.assignee?.firstName} ${task.assignee?.lastName}`} size={6} />
      )}
    </div>
  );
}

/* ── Project Card ─────────────────────────────────────────────── */
function ProjectCard({ project, onClick }) {
  const color = project.color || COLORS[0];
  const s = STATUS_CONFIG[project.status] || STATUS_CONFIG.active;
  const initials = project.name?.slice(0,2).toUpperCase() || 'PR';

  return (
    <div onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group overflow-hidden">
      <div className="h-1.5" style={{ background: color }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0"
              style={{ background: color }}>
              {initials}
            </div>
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-bold text-slate-800 truncate group-hover:text-blue-600 transition-colors">{project.name}</h3>
              {project.description && (
                <p className="text-[11.5px] text-slate-400 truncate mt-0.5">{project.description}</p>
              )}
            </div>
          </div>
          <StatusBadge status={project.status} />
        </div>

        <div className="flex items-center gap-4 text-[11.5px] text-slate-500 mb-4">
          <span className="flex items-center gap-1"><Users size={11} className="text-slate-400" />{project.memberCount || 0} members</span>
          <span className="flex items-center gap-1"><CheckSquare size={11} className="text-slate-400" />{project.taskCount || 0} tasks</span>
          {project.estimatedHours > 0 && (
            <span className="flex items-center gap-1"><Clock size={11} className="text-slate-400" />{project.estimatedHours}h</span>
          )}
        </div>

        <div className="flex items-center justify-between text-[11.5px] text-slate-400">
          <div className="flex -space-x-2">
            {(project.members || []).slice(0,4).map((m, i) => (
              <div key={i} className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 border-2 border-white flex items-center justify-center text-white text-[9px] font-bold">
                {m.firstName?.[0]}{m.lastName?.[0]}
              </div>
            ))}
          </div>
          <span className="flex items-center gap-1 text-blue-500 font-semibold group-hover:gap-2 transition-all">
            View <ChevronRight size={12} />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────── */
export default function TeamProjects() {
  const [projects, setProjects]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [filterStatus, setFilter]     = useState('all');
  const [selected, setSelected]       = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/projects').then(r => setProjects(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = projects.filter(p => {
    const ms = p.name?.toLowerCase().includes(search.toLowerCase());
    const mf = filterStatus === 'all' || p.status === filterStatus;
    return ms && mf;
  });

  const stats = {
    total:     projects.length,
    active:    projects.filter(p => p.status === 'active').length,
    completed: projects.filter(p => p.status === 'completed').length,
    onHold:    projects.filter(p => p.status === 'on_hold').length,
  };

  return (
    <div className="p-6 space-y-5 max-w-6xl">

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'All Projects', val: stats.total,     icon: Briefcase,   color: 'text-slate-700',   bg: 'bg-slate-100' },
          { label: 'Active',       val: stats.active,    icon: CheckSquare, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Completed',    val: stats.completed, icon: CheckCircle2,color: 'text-blue-600',    bg: 'bg-blue-50' },
          { label: 'On Hold',      val: stats.onHold,    icon: Clock,       color: 'text-amber-600',   bg: 'bg-amber-50' },
        ].map(({ label, val, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={18} className={color} />
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects…"
            className="w-full pl-9 pr-4 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white" />
        </div>
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
          {[['all','All'],['active','Active'],['completed','Done'],['on_hold','On Hold']].map(([k,l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-all ${filterStatus === k ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {l}
            </button>
          ))}
        </div>
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
            {search ? 'No matching projects' : 'No team projects yet'}
          </p>
          <p className="text-[12.5px] text-slate-400 mt-1">
            {search ? 'Try a different keyword' : 'Projects created in the Time Tracker will appear here'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => (
            <ProjectCard key={p._id} project={p} onClick={() => setSelected(p)} />
          ))}
        </div>
      )}

      {/* Detail Drawer */}
      {selected && (
        <ProjectDrawer
          project={selected}
          onClose={() => setSelected(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}
