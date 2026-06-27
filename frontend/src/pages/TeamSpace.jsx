import React, { useState, useEffect } from 'react';
import { Users, MessageSquare, BarChart2, MapPin, UserPlus, Clock, Cake } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const Tab = ({ active, onClick, children }) => (
  <button onClick={onClick}
    className={`py-3 px-1 text-[15px] font-medium border-b-2 transition-all whitespace-nowrap
      ${active ? 'border-blue-500 text-blue-600 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
    {children}
  </button>
);

const EmptyState = ({ icon: Icon, title, sub }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
      <Icon size={24} className="text-slate-400"/>
    </div>
    <p className="text-[15px] font-semibold text-slate-500">{title}</p>
    <p className="text-[14px] text-slate-400 mt-1">{sub}</p>
  </div>
);

function PanelCard({ icon: Icon, title, children }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} className="text-blue-500"/>
        <h3 className="text-[13px] font-bold text-slate-800">{title}</h3>
      </div>
      <div className="text-[13px] text-slate-600">{children}</div>
    </div>
  );
}

function PersonLine({ p }) {
  return (
    <div className="flex items-center gap-2 py-1">
      {p.photoUrl ? (
        <img src={p.photoUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-slate-200" />
      ) : (
        <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[12px] font-bold border border-slate-200">
          {(p.firstName?.[0] || '') + (p.lastName?.[0] || '')}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-slate-700 truncate leading-tight">
          {p.employeeId ? <span className="text-slate-400 font-mono mr-1">{p.employeeId}</span> : null}
          {p.firstName} {p.lastName}
        </p>
        {p.workLocation && <p className="text-[12px] text-slate-400 truncate">{p.workLocation}</p>}
        {p.designation  && <p className="text-[12px] text-slate-400 truncate">{p.designation}</p>}
      </div>
    </div>
  );
}

export default function TeamSpace() {
  const { user } = useAuth();
  const [tab, setTab] = useState('wall');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api.get('/team/space')
      .then(r => setData(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?._id]);

  const deptName = data?.department || user?.department || '—';
  const avail    = data?.teamAvailability || { in: 0, out: 0, yetToCheckIn: 0 };

  return (
    <div className="flex gap-5 p-6 min-h-[calc(100vh-100px)]">
      {/* Main area: department wall / groups / surveys (placeholder for now) */}
      <div className="flex-1 min-w-0 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        {/* Department header card */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-[18px]">
            {(deptName || 'D').charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-[15px] text-slate-400 leading-tight">Department</p>
            <p className="text-[17px] font-bold text-slate-800">{deptName}</p>
          </div>
        </div>

        <div className="flex items-center gap-6 px-5 border-b border-slate-100 overflow-x-auto scrollbar-none">
          {[['wall','Department Wall'],['groups','Groups'],['surveys','Surveys']].map(([k,l]) => (
            <Tab key={k} active={tab===k} onClick={()=>setTab(k)}>{l}</Tab>
          ))}
        </div>
        <div className="flex-1 bg-slate-50 p-4 overflow-y-auto">
          {tab==='wall'     && <EmptyState icon={MessageSquare} title="No Feeds Yet" sub="Department posts will appear here"/>}
          {tab==='groups'   && <EmptyState icon={Users}         title="No groups"    sub="Groups and teams will appear here"/>}
          {tab==='surveys'  && <EmptyState icon={BarChart2}     title="No surveys"   sub="Team surveys will appear here"/>}
        </div>
      </div>

      {/* Right sidebar panels */}
      <div className="w-[260px] flex-shrink-0 space-y-3">
        <PanelCard icon={Users} title="Team Strength">
          {loading ? '—' : (
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Total members</span>
              <span className="text-[16px] font-bold text-slate-800">{data?.teamStrength ?? 0}</span>
            </div>
          )}
        </PanelCard>

        <PanelCard icon={Clock} title="Team Availability">
          {loading ? '—' : (
            <div className="space-y-1">
              <Row dot="bg-emerald-500" label="In"               value={avail.in}/>
              <Row dot="bg-slate-400"   label="Out"              value={avail.out}/>
              <Row dot="bg-amber-500"   label="Yet to check-in"  value={avail.yetToCheckIn}/>
            </div>
          )}
        </PanelCard>

        <PanelCard icon={MapPin} title="Location Diversity">
          {loading ? '—' : (data?.locationDiversity || []).length === 0 ? (
            <p className="text-slate-400">No locations on file</p>
          ) : (
            <div className="space-y-1">
              {(data?.locationDiversity || []).map(l => (
                <div key={l.location} className="flex items-center justify-between">
                  <span className="text-slate-600 truncate" title={l.location}>{l.location}</span>
                  <span className="text-[13px] font-bold text-slate-800 ml-2">{l.n}</span>
                </div>
              ))}
            </div>
          )}
        </PanelCard>

        <PanelCard icon={Clock} title="Recently Checked In">
          {loading ? '—' : (data?.recentlyCheckedIn || []).length === 0 ? (
            <p className="text-slate-400">No check-ins yet today</p>
          ) : (
            <div>
              {(data?.recentlyCheckedIn || []).map(p => <PersonLine key={p.id} p={p}/>)}
            </div>
          )}
        </PanelCard>

        <PanelCard icon={UserPlus} title="New Hires">
          {loading ? '—' : (data?.newHires || []).length === 0 ? (
            <p className="text-slate-400">No new hires in the last 15 days</p>
          ) : (
            <div>
              {(data?.newHires || []).map(p => <PersonLine key={p.id} p={p}/>)}
            </div>
          )}
        </PanelCard>

        <PanelCard icon={Cake} title="Birthday Buddy">
          {loading ? '—' : (data?.birthdayBuddy || []).length === 0 ? (
            <p className="text-slate-400">No birthday celebrations today</p>
          ) : (
            <div>
              {(data?.birthdayBuddy || []).map(p => <PersonLine key={p.id} p={p}/>)}
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  );
}

function Row({ dot, label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-slate-600">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`}/>{label}
      </span>
      <span className="text-[13px] font-bold text-slate-800">{value || 0}</span>
    </div>
  );
}
