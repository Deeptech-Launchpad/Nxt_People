import React, { useState, useEffect, useMemo } from 'react';
import { Search, Phone, MessageSquare, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { PhotoAvatar } from '../components/ui';

/* ── Peers — colleagues who report to the same manager as you.
 *  Zoho shows your reporting manager at the top + "Members N" on the
 *  right, then a grid of every direct report of that manager (excluding
 *  yourself). Falls back to "all of my department" if the user has no
 *  reporting manager set (e.g. CEOs / top of the tree). */
export default function Peers() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [me, setMe] = useState(null);                  // own row (for reportingManagerId + manager metadata)
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?._id) return;
    setLoading(true);
    Promise.all([
      api.get('/employees?limit=500&status=active'),
      api.get(`/employees/${user._id}`),
    ]).then(([list, meRes]) => {
      setEmployees(list.data.data || []);
      setMe(meRes.data.data || null);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user?._id]);

  const myManagerId = me?.reporting_manager_id || me?.reportingManagerId || null;

  // Peers = employees who share my reporting manager (excluding me). If I
  // have no manager (top of the org), show department colleagues so the
  // page isn't empty for execs.
  const peers = useMemo(() => {
    if (!me) return [];
    if (myManagerId) {
      return employees.filter(e =>
        e._id !== user._id &&
        (e.reportingManagerId === myManagerId || e.reporting_manager_id === myManagerId)
      );
    }
    if (me.department) {
      return employees.filter(e => e._id !== user._id && e.department === me.department);
    }
    return [];
  }, [employees, me, myManagerId, user?._id]);

  const filtered = useMemo(() => peers.filter(e =>
    !search || `${e.firstName} ${e.lastName} ${e.designation || ''} ${e.department || ''} ${e.employeeId || ''}`
      .toLowerCase().includes(search.toLowerCase())
  ), [peers, search]);

  const managerName = me?.manager
    ? `${me.manager.firstName || ''} ${me.manager.lastName || ''}`.trim()
    : null;
  const managerCode = me?.manager?.employeeId || me?.manager?.id || null;

  return (
    <div className="p-6">
      {/* Header — manager breadcrumb + member count (matches Zoho) */}
      {!loading && me && (
        <div className="flex items-center justify-between mb-5 bg-white rounded-lg border border-slate-200 px-5 py-3">
          <div className="flex items-center gap-3">
            {myManagerId ? (
              <>
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                  <Users size={16} className="text-slate-400"/>
                </div>
                <div className="text-[15px] text-slate-700">
                  Peers reporting to <span className="font-semibold text-slate-900">
                    {managerCode ? `${managerCode} — ` : ''}{managerName || 'your manager'}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-[15px] text-slate-700">
                Colleagues in <span className="font-semibold text-slate-900">{me.department || 'your department'}</span>
              </div>
            )}
          </div>
          <div className="text-[14px] text-slate-500">
            Members <span className="ml-1 font-bold text-slate-800">{peers.length}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search peers…"
            className="w-full pl-9 pr-4 py-2 text-[14px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"/>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin"/>
        </div>
      ) : peers.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-base">
          {myManagerId
            ? 'No peers found — nobody else reports to your manager.'
            : 'You have no reporting person set, and no department colleagues to show.'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map(e => {
            const phoneNum  = e.phone || e.workPhone;
            const telHref   = phoneNum ? `tel:${phoneNum}` : null;
            return (
              <div key={e._id} className="bg-white rounded-lg border border-slate-200 p-4 text-center shadow-sm hover:shadow-md transition-all">
                <PhotoAvatar
                  photoUrl={e.photoUrl}
                  firstName={e.firstName}
                  lastName={e.lastName}
                  className="w-14 h-14 mx-auto mb-3 border-2 border-white shadow"
                  textClassName="text-base"
                />
                <p className="text-[14px] font-semibold text-slate-800 truncate">{e.firstName} {e.lastName}</p>
                <p className="text-[13px] text-slate-500 truncate mt-0.5">{e.designation || '—'}</p>
                <p className="text-[12px] text-blue-500 truncate">{e.department || '—'}</p>
                <div className="flex items-center justify-center gap-3 mt-3">
                  {telHref ? (
                    <a href={telHref} title="Call" className="text-slate-400 hover:text-blue-500 transition-colors"><Phone size={13}/></a>
                  ) : (
                    <span className="text-slate-200" title="No phone on file"><Phone size={13}/></span>
                  )}
                  {/* Chat button → opens the in-app chat with this peer
                      pre-selected (sends a connection request automatically
                      if not yet connected). Previously this was a mailto: */}
                  <button
                    type="button"
                    onClick={() => navigate(`/chat?user=${e._id}`)}
                    title="Chat"
                    className="text-slate-400 hover:text-blue-500 transition-colors"
                  >
                    <MessageSquare size={13}/>
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-16 text-slate-400 text-base">No peers match your search.</div>
          )}
        </div>
      )}
    </div>
  );
}
