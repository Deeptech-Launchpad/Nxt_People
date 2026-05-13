import React, { useState, useEffect } from 'react';
import { Plus, X, Star, ChevronRight, Edit3, Trash2, Send, CheckCircle } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

const STATUS_STYLE = { draft: 'bg-slate-100 text-slate-600', submitted: 'bg-blue-100 text-blue-700', completed: 'bg-emerald-100 text-emerald-700' };
const RATING_LABELS = { 1: 'Poor', 2: 'Below Average', 3: 'Average', 4: 'Good', 5: 'Excellent' };
const GOAL_STATUS = { in_progress: 'In Progress', completed: 'Completed', not_started: 'Not Started' };

const StarRating = ({ value, onChange, readOnly }) => (
  <div className="flex gap-1">
    {[1,2,3,4,5].map(s => (
      <button key={s} type="button" onClick={() => !readOnly && onChange && onChange(s)} className={`transition-colors ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}>
        <Star size={18} className={s <= (value || 0) ? 'text-amber-400 fill-amber-400' : 'text-slate-200'} />
      </button>
    ))}
  </div>
);

export default function Performance() {
  const { user } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ employeeId: '', cycleName: '', periodStart: '', periodEnd: '', goals: [] });
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/performance').then(r => setReviews(r.data.data || [])).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    if (user?.role !== 'employee') api.get('/employees?limit=200').then(r => setEmployees(r.data.data || [])).catch(() => {});
  }, [user]);

  const openReview = (review) => {
    setSelected(review);
    setDetailLoading(true);
    api.get(`/performance/${review._id}`).then(r => {
      setSelectedDetail(r.data.data);
      setEditData({ overallRating: r.data.data.overallRating, reviewerComments: r.data.data.reviewerComments || '', employeeComments: r.data.data.employeeComments || '', status: r.data.data.status, goals: r.data.data.goals?.map(g => ({ ...g })) || [] });
    }).catch(console.error).finally(() => setDetailLoading(false));
    setEditMode(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/performance', form);
      toast.success('Review cycle created!');
      setCreateModal(false); setForm({ employeeId: '', cycleName: '', periodStart: '', periodEnd: '', goals: [] });
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await api.put(`/performance/${selected._id}`, editData);
      toast.success('Review updated!');
      setEditMode(false); openReview(selected);
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this review?')) return;
    try { await api.delete(`/performance/${id}`); toast.success('Deleted'); load(); if (selected?._id === id) setSelected(null); }
    catch (err) { toast.error('Failed'); }
  };

  const addGoal = () => setForm(f => ({ ...f, goals: [...f.goals, { title: '', description: '', target: '', weight: 1 }] }));
  const updateGoal = (i, field, val) => setForm(f => { const g = [...f.goals]; g[i] = { ...g[i], [field]: val }; return { ...f, goals: g }; });
  const removeGoal = (i) => setForm(f => ({ ...f, goals: f.goals.filter((_, idx) => idx !== i) }));

  if (selected) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelected(null)} className="text-sm text-slate-400 hover:text-brand-600 flex items-center gap-1 transition-colors">← Back to Reviews</button>
          <ChevronRight size={14} className="text-slate-300" />
          <span className="text-sm font-medium text-slate-700">{selected.cycleName}</span>
        </div>

        {detailLoading ? (
          <div className="flex justify-center py-20"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
        ) : selectedDetail && (
          <>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h3 className="font-display font-bold text-slate-800 text-xl">{selectedDetail.cycleName}</h3>
                  <p className="text-slate-400 text-sm">{selectedDetail.employee?.firstName} {selectedDetail.employee?.lastName} · {selectedDetail.employee?.designation}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{selectedDetail.periodStart?.split('T')[0]} to {selectedDetail.periodEnd?.split('T')[0]}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-3 py-1 rounded-full font-medium capitalize ${STATUS_STYLE[selectedDetail.status]}`}>{selectedDetail.status}</span>
                  {user?.role !== 'employee' && !editMode && <button onClick={() => setEditMode(true)} className="flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-xl text-xs font-medium"><Edit3 size={13}/> Edit</button>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-5 mb-5">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Overall Rating</p>
                  {editMode ? (
                    <StarRating value={editData.overallRating} onChange={v => setEditData(d => ({ ...d, overallRating: v }))} />
                  ) : (
                    <div className="flex items-center gap-2"><StarRating value={selectedDetail.overallRating} readOnly /><span className="text-sm text-slate-500">{RATING_LABELS[selectedDetail.overallRating] || 'Not rated'}</span></div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Status</p>
                  {editMode ? (
                    <select value={editData.status} onChange={e => setEditData(d => ({ ...d, status: e.target.value }))} className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400">
                      {Object.entries(STATUS_STYLE).map(([k]) => <option key={k} value={k} className="capitalize">{k}</option>)}
                    </select>
                  ) : <p className="text-sm text-slate-700 capitalize">{selectedDetail.status}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Reviewer Comments</p>
                  {editMode ? <textarea value={editData.reviewerComments} onChange={e => setEditData(d => ({ ...d, reviewerComments: e.target.value }))} rows={3} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 resize-none" />
                  : <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3 min-h-[60px]">{selectedDetail.reviewerComments || <span className="text-slate-300 italic">No comments</span>}</p>}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Employee Comments</p>
                  {editMode || user?._id === selectedDetail.employee?._id ? (
                    <textarea value={editData?.employeeComments} onChange={e => setEditData(d => ({ ...d, employeeComments: e.target.value }))} rows={3} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 resize-none" />
                  ) : <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3 min-h-[60px]">{selectedDetail.employeeComments || <span className="text-slate-300 italic">No comments</span>}</p>}
                </div>
              </div>

              {editMode && (
                <div className="flex gap-3 mt-5 pt-4 border-t border-slate-100">
                  <button onClick={() => setEditMode(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={handleSaveEdit} disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    <Send size={14}/>{saving ? 'Saving...' : 'Save Review'}
                  </button>
                </div>
              )}
            </div>

            {/* Goals */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100"><h4 className="font-display font-semibold text-slate-800">KPIs / Goals</h4></div>
              {(selectedDetail.goals || []).length === 0 ? (
                <p className="text-slate-300 text-sm text-center py-10">No goals defined</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {(editMode ? editData.goals : selectedDetail.goals).map((g, i) => (
                    <div key={g._id || i} className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-2">
                        <p className="font-medium text-slate-700">{g.title}</p>
                        {g.description && <p className="text-xs text-slate-400 mt-0.5">{g.description}</p>}
                        {g.target && <p className="text-xs text-brand-600 mt-1"><span className="font-medium">Target:</span> {g.target}</p>}
                        {editMode ? (
                          <div className="mt-2">
                            <textarea value={g.achievement || ''} onChange={e => { const gs = [...editData.goals]; gs[i] = { ...gs[i], achievement: e.target.value }; setEditData(d => ({ ...d, goals: gs })); }} rows={2} placeholder="Achievement notes..." className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 resize-none" />
                            <select value={g.status || 'in_progress'} onChange={e => { const gs = [...editData.goals]; gs[i] = { ...gs[i], status: e.target.value }; setEditData(d => ({ ...d, goals: gs })); }} className="mt-2 border border-slate-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-brand-400">
                              {Object.entries(GOAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                        ) : g.achievement && <p className="text-xs text-slate-500 mt-1 italic">{g.achievement}</p>}
                      </div>
                      <div className="text-right">
                        {editMode ? (
                          <StarRating value={g.rating} onChange={v => { const gs = [...editData.goals]; gs[i] = { ...gs[i], rating: v }; setEditData(d => ({ ...d, goals: gs })); }} />
                        ) : <StarRating value={g.rating} readOnly />}
                        <span className="text-xs text-slate-400">Weight: {g.weight}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-slate-800 text-xl">Performance Reviews</h2>
          <p className="text-slate-400 text-sm mt-0.5">{reviews.length} review cycle{reviews.length !== 1 ? 's' : ''}</p>
        </div>
        {user?.role !== 'employee' && (
          <button onClick={() => setCreateModal(true)} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Plus size={16}/> Create Review
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm text-center py-20">
          <Star size={40} className="text-slate-200 mx-auto mb-3"/>
          <p className="text-slate-400 font-medium">No performance reviews yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {reviews.map(r => (
            <div key={r._id} onClick={() => openReview(r)} className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer p-5 group">
              <div className="flex items-start justify-between mb-3">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                {user?.role === 'admin' && (
                  <button onClick={e => { e.stopPropagation(); handleDelete(r._id); }} className="w-7 h-7 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all">
                    <Trash2 size={13}/>
                  </button>
                )}
              </div>
              <h3 className="font-display font-semibold text-slate-800 mb-1">{r.cycleName}</h3>
              <p className="text-sm text-slate-500">{r.employee?.firstName} {r.employee?.lastName}</p>
              <p className="text-xs text-slate-400 mt-0.5">{r.employee?.designation} · {r.employee?.department}</p>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                <StarRating value={r.overallRating} readOnly />
                <span className="text-xs text-slate-400">{r.periodStart?.split('T')[0]?.substring(0, 7)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {createModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
              <h3 className="font-display font-semibold text-slate-800 text-lg">Create Review Cycle</h3>
              <button onClick={() => setCreateModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Employee *</label>
                <select value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                  <option value="">Select employee...</option>
                  {employees.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName} — {e.designation}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Cycle Name *</label>
                <input value={form.cycleName} onChange={e => setForm({ ...form, cycleName: e.target.value })} required placeholder="e.g., Q1 2026 Review" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Period Start *</label>
                  <input type="date" value={form.periodStart} onChange={e => setForm({ ...form, periodStart: e.target.value })} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Period End *</label>
                  <input type="date" value={form.periodEnd} onChange={e => setForm({ ...form, periodEnd: e.target.value })} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">KPIs / Goals</p>
                  <button type="button" onClick={addGoal} className="text-xs text-brand-600 font-medium hover:underline flex items-center gap-1"><Plus size={12}/> Add Goal</button>
                </div>
                {form.goals.map((g, i) => (
                  <div key={i} className="bg-slate-50 rounded-xl p-3 mb-2 space-y-2">
                    <div className="flex gap-2">
                      <input value={g.title} onChange={e => updateGoal(i, 'title', e.target.value)} placeholder="Goal title *" className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-400"/>
                      <button type="button" onClick={() => removeGoal(i)} className="text-slate-400 hover:text-red-500"><X size={14}/></button>
                    </div>
                    <input value={g.target} onChange={e => updateGoal(i, 'target', e.target.value)} placeholder="Target / KPI" className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-400"/>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setCreateModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60">{saving ? 'Creating...' : 'Create Review'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
