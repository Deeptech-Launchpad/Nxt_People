import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Briefcase, CheckCircle, Plus } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', description: '' });

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const r = await api.get('/projects');
      setProjects(r.data.data);
    } catch (e) {
      toast.error('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/projects', form);
      setProjects([res.data.data, ...projects]);
      setForm({ name: '', description: '' });
      toast.success('Project created');
    } catch (err) {
      toast.error('Failed to create project');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-2"><Briefcase className="text-brand-500" /> Projects & Tasks</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-fit">
          <h3 className="font-semibold mb-4 text-slate-800 flex items-center gap-2"><Plus size={18}/> New Project</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-600">Project Name</label>
              <input required value={form.name} onChange={e=>setForm({...form, name: e.target.value})} className="w-full mt-1 p-2 border rounded-lg text-base" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-600">Description</label>
              <textarea required value={form.description} onChange={e=>setForm({...form, description: e.target.value})} className="w-full mt-1 p-2 border rounded-lg text-base" rows="3"></textarea>
            </div>
            <button className="w-full bg-brand-600 text-white py-2 rounded-lg font-medium hover:bg-brand-500 transition">Create Project</button>
          </form>
        </div>

        <div className="md:col-span-2 space-y-4">
          {loading ? <p>Loading...</p> : projects.map(p => (
            <div key={p._id || p.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800">{p.name}</h3>
                <p className="text-base text-slate-500 mt-1">{p.description}</p>
              </div>
              <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1 capitalize"><CheckCircle size={12}/> {p.status || 'Active'}</span>
            </div>
          ))}
          {!loading && projects.length === 0 && <p className="text-slate-500 text-center p-6 border border-dashed rounded-xl">No projects found. Create one to get started.</p>}
        </div>
      </div>
    </div>
  );
}
