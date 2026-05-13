import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { Building2, Plus, Pencil, Trash2, Layers, X, Check, ChevronDown, ChevronRight } from 'lucide-react';

function CompanyModal({ company, onClose, onSaved }) {
  const isEdit = !!company;
  const [form, setForm] = useState(
    isEdit ? { name: company.name, code: company.code || '', description: company.description || '' } : { name: '', code: '', description: '' }
  );
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Company name is required');
    setLoading(true);
    try {
      if (isEdit) await api.put(`/companies/${company._id}`, form);
      else await api.post('/companies', form);
      toast.success(isEdit ? 'Company updated' : 'Company created');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h3 className="font-display font-bold text-slate-800 text-lg mb-5">{isEdit ? 'Edit Company' : 'Add Company'}</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Company name <span className="text-red-400">*</span></label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-white border border-slate-200 text-slate-800 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 placeholder-slate-400" placeholder="e.g. Acme Corporation" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Short code</label>
            <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} className="w-full bg-white border border-slate-200 text-slate-800 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 placeholder-slate-400" placeholder="e.g. ACME" maxLength={8} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full bg-white border border-slate-200 text-slate-800 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 placeholder-slate-400 resize-none" placeholder="Optional description" />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-white hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm transition-all">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="flex-1 bg-brand-600 hover:bg-brand-500 text-slate-800 font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-60 flex items-center justify-center gap-1.5">
            {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Check size={14} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function DivisionManager({ company, onUpdated }) {
  const [newDiv, setNewDiv] = useState('');
  const [loading, setLoading] = useState(false);

  const addDivision = async () => {
    if (!newDiv.trim()) return;
    setLoading(true);
    try {
      const updated = { ...company, divisions: [...(company.divisions || []), { name: newDiv.trim() }] };
      await api.put(`/companies/${company._id}`, { divisions: updated.divisions });
      toast.success('Division added');
      setNewDiv('');
      onUpdated();
    } catch (err) {
      toast.error('Failed to add division');
    } finally {
      setLoading(false);
    }
  };

  const removeDivision = async (divId) => {
    try {
      const divisions = company.divisions.filter(d => d._id !== divId);
      await api.put(`/companies/${company._id}`, { divisions });
      toast.success('Division removed');
      onUpdated();
    } catch (err) {
      toast.error('Failed to remove division');
    }
  };

  return (
    <div className="mt-4 pl-4 border-l-2 border-slate-200">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Divisions</p>
      <div className="space-y-1.5 mb-3">
        {(company.divisions || []).length === 0
          ? <p className="text-slate-600 text-xs italic">No divisions yet</p>
          : company.divisions.map(d => (
            <div key={d._id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <span className="text-slate-700 text-sm">{d.name}</span>
              <button onClick={() => removeDivision(d._id)} className="text-slate-600 hover:text-red-400 transition-colors ml-2"><X size={13} /></button>
            </div>
          ))}
      </div>
      <div className="flex gap-2">
        <input value={newDiv} onChange={e => setNewDiv(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDivision()} placeholder="Add division…" className="flex-1 bg-white border border-slate-200 text-slate-800 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-brand-500 placeholder-slate-400" />
        <button onClick={addDivision} disabled={loading || !newDiv.trim()} className="bg-brand-600/80 hover:bg-brand-600 text-slate-800 px-3 py-2 rounded-lg text-sm transition-all disabled:opacity-50 flex items-center gap-1">
          {loading ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={14} />}
        </button>
      </div>
    </div>
  );
}

export default function Companies() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/companies');
      setCompanies(res.data.data);
    } catch (err) {
      toast.error('Failed to load companies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const deleteCompany = async (id, name) => {
    if (!confirm(`Deactivate "${name}"?`)) return;
    try {
      await api.delete(`/companies/${id}`);
      toast.success('Company deactivated');
      fetchCompanies();
    } catch (err) {
      toast.error('Failed to deactivate');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-slate-800 text-2xl">Companies & Divisions</h1>
          <p className="text-slate-500 text-sm mt-1">Configure companies and their divisions shown during registration.</p>
        </div>
        <button onClick={() => { setEditTarget(null); setModalOpen(true); }} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-slate-800 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-brand-500/20">
          <Plus size={15} /> Add Company
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white shadow-sm border border-slate-200 rounded-2xl">
          <Building2 size={40} className="text-slate-600 mb-3" />
          <p className="text-slate-500 text-sm mb-1">No companies configured yet.</p>
          <p className="text-slate-600 text-xs">Add your first company to allow users to register.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {companies.map(company => (
            <div key={company._id} className="bg-white shadow-sm border border-slate-200 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
                    <Building2 size={16} className="text-brand-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-slate-800 font-semibold text-sm">{company.name}</p>
                      {company.code && <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">{company.code}</span>}
                    </div>
                    {company.description && <p className="text-slate-500 text-xs mt-0.5">{company.description}</p>}
                    <p className="text-slate-600 text-xs mt-0.5">{(company.divisions || []).length} division{(company.divisions || []).length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setExpandedId(expandedId === company._id ? null : company._id)} className="text-slate-500 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition-all">
                    {expandedId === company._id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <button onClick={() => { setEditTarget(company); setModalOpen(true); }} className="text-slate-500 hover:text-brand-400 p-2 rounded-lg hover:bg-slate-100 transition-all">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => deleteCompany(company._id, company.name)} className="text-slate-500 hover:text-red-400 p-2 rounded-lg hover:bg-slate-100 transition-all">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {expandedId === company._id && (
                <div className="px-5 pb-5 border-t border-slate-100">
                  <DivisionManager company={company} onUpdated={fetchCompanies} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <CompanyModal
          company={editTarget}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
          onSaved={() => { setModalOpen(false); setEditTarget(null); fetchCompanies(); }}
        />
      )}
    </div>
  );
}
