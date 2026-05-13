import React, { useState, useEffect } from 'react';
import { Search, Phone, Mail } from 'lucide-react';
import api from '../utils/api';

export default function Peers() {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/employees?limit=200&status=active')
      .then(r => setEmployees(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = employees.filter(e =>
    !search || `${e.firstName} ${e.lastName} ${e.designation} ${e.department}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search peers…"
            className="w-full pl-9 pr-4 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"/>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin"/></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map(e => (
            <div key={e._id} className="bg-white rounded-lg border border-slate-200 p-4 text-center shadow-sm hover:shadow-md transition-all">
              <img src={`https://ui-avatars.com/api/?name=${e.firstName}+${e.lastName}&background=e0e7ff&color=4f46e5&size=64`}
                className="w-14 h-14 rounded-full mx-auto mb-3 border-2 border-white shadow" alt={e.firstName}/>
              <p className="text-[12.5px] font-semibold text-slate-800 truncate">{e.firstName} {e.lastName}</p>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">{e.designation || '—'}</p>
              <p className="text-[10.5px] text-blue-500 truncate">{e.department || '—'}</p>
              <div className="flex items-center justify-center gap-3 mt-3 text-slate-300">
                <button className="hover:text-blue-500 transition-colors"><Phone size={13}/></button>
                <button className="hover:text-blue-500 transition-colors"><Mail size={13}/></button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="col-span-full text-center py-16 text-slate-400 text-sm">No peers found</div>}
        </div>
      )}
    </div>
  );
}
