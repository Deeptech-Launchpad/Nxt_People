import React, { useState } from 'react';
import { Users, MessageSquare, BarChart2, MapPin, UserPlus, Clock } from 'lucide-react';

const Tab = ({ active, onClick, children }) => (
  <button onClick={onClick}
    className={`py-3 px-1 text-[13px] font-medium border-b-2 transition-all whitespace-nowrap
      ${active ? 'border-blue-500 text-blue-600 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
    {children}
  </button>
);

const EmptyState = ({ icon: Icon, title, sub }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
      <Icon size={24} className="text-slate-400"/>
    </div>
    <p className="text-[13px] font-semibold text-slate-500">{title}</p>
    <p className="text-[12px] text-slate-400 mt-1">{sub}</p>
  </div>
);

export default function TeamSpace() {
  const [tab, setTab] = useState('wall');
  return (
    <div className="flex gap-5 p-6 min-h-[calc(100vh-100px)]">
      {/* Main area */}
      <div className="flex-1 min-w-0 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="flex items-center gap-6 px-5 border-b border-slate-100 overflow-x-auto scrollbar-none">
          {[['wall','Department Wall'],['groups','Groups'],['surveys','Surveys']].map(([k,l]) => (
            <Tab key={k} active={tab===k} onClick={()=>setTab(k)}>{l}</Tab>
          ))}
        </div>
        <div className="flex-1 bg-slate-50 p-4 overflow-y-auto">
          {tab==='wall'     && <EmptyState icon={MessageSquare} title="No posts yet" sub="Department posts will appear here"/>}
          {tab==='groups'   && <EmptyState icon={Users}         title="No groups"    sub="Groups and teams will appear here"/>}
          {tab==='surveys'  && <EmptyState icon={BarChart2}     title="No surveys"   sub="Team surveys will appear here"/>}
        </div>
      </div>

      {/* Right sidebar panels */}
      <div className="w-[240px] flex-shrink-0 space-y-3">
        {[
          { title:'Team Strength',        icon:Users,    content:'—' },
          { title:'Team Availability',    icon:Clock,    content:'In: — / Out: —' },
          { title:'Location Diversity',   icon:MapPin,   content:'—' },
          { title:'Recently Checked In',  icon:Clock,    content:'No check-ins yet' },
          { title:'New Hires',            icon:UserPlus, content:'No new hires this month' },
        ].map(({title,icon:Icon,content}) => (
          <div key={title} className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={13} className="text-blue-500"/>
              <h3 className="text-[11.5px] font-bold text-slate-800">{title}</h3>
            </div>
            <p className="text-[11.5px] text-slate-400">{content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
