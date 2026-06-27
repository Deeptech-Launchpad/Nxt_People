/**
 * Employee → My Apps
 * Tile launcher of all internal websites the logged-in employee has been
 * granted access to. Click a tile → opens the app's URL in a new tab.
 * Data comes from GET /api/my-apps (active grants on user-facing apps).
 */
import React, { useEffect, useState } from 'react';
import {
  ExternalLink, Layers, Globe, BookOpen, BarChart3, Briefcase, Calendar,
  Cloud, Cog, Database, FileText, Image, Lock, Mail, Map, Phone, Server,
  Star, Tag, AppWindow, Inbox,
} from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';

const ICONS = {
  Layers, Globe, BookOpen, BarChart3, Briefcase, Calendar, Cloud, Cog,
  Database, FileText, Image, Lock, Mail, Map, Phone, Server, Star, Tag,
};
const Icon = ({ name, ...rest }) => {
  const Cmp = ICONS[name] || Layers;
  return <Cmp {...rest} />;
};

export default function MyApps() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/my-apps')
      .then(r => setApps(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load apps'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-slate-800 flex items-center gap-2">
          <AppWindow size={22} className="text-indigo-500" /> My Apps
        </h1>
        <p className="text-[15px] text-slate-500 mt-1 max-w-2xl">
          Your launcher for internal company websites. Only apps you have access to appear here — ask HR if something's missing.
        </p>
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-400">Loading…</div>
      ) : apps.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-16 text-center">
          <Inbox size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="text-[16px] font-semibold text-slate-700">No apps yet</p>
          <p className="text-[14px] text-slate-500 mt-1 max-w-md mx-auto">
            You haven't been granted access to any internal apps. If you think this is a mistake, please reach out to HR.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {apps.map(app => (
            <a key={app.id}
               href={app.websiteUrl || '#'}
               target="_blank" rel="noopener noreferrer"
               onClick={e => { if (!app.websiteUrl) { e.preventDefault(); toast.error('No URL configured for this app'); } }}
               className="group bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all">
              <div className={`bg-gradient-to-br ${app.color || 'from-blue-500 to-indigo-600'} px-5 py-6 text-white relative`}>
                <Icon name={app.icon} size={32} strokeWidth={1.7} />
                <ExternalLink size={14} className="absolute top-3 right-3 opacity-60 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="p-4">
                <h3 className="text-[14.5px] font-bold text-slate-800">{app.name}</h3>
                {app.description && (
                  <p className="text-[13px] text-slate-500 mt-1 leading-relaxed line-clamp-2">{app.description}</p>
                )}
                {app.websiteUrl && (
                  <p className="text-[12px] text-slate-400 mt-2 truncate font-mono">{app.websiteUrl.replace(/^https?:\/\//, '')}</p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
