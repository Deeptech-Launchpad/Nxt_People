import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import SmartChat from '../SmartChat';
import GuidedTour from '../GuidedTour';
import GeoPermissionModal from '../GeoPermissionModal';
import { Moon, Sun, Volume2, VolumeX, HelpCircle, MapPin } from 'lucide-react';

export default function Layout() {
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('nxt-dark') === '1');
  const [muted, setMuted] = useState(false);
  const [smartChatOpen, setSmartChatOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  /* Apply dark class on mount and whenever darkMode changes */
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('nxt-dark', '1');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('nxt-dark', '0');
    }
  }, [darkMode]);

  /* Global Ctrl+Space (and Cmd+Space on Mac) toggles the Smart Chat palette. */
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code === 'Space' && (e.ctrlKey || e.metaKey)) {
        // Don't hijack the shortcut while the user is typing in an input/textarea.
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
        e.preventDefault();
        setSmartChatOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex min-h-screen bg-[#f2f3f7]">
      <Sidebar />
      {/* min-w-0 is load-bearing: a flex item defaults to min-width:auto, so
          without it this column refuses to shrink below its widest child. A
          wide report grid then stretched the whole page, the document scrolled
          sideways, and the frozen employee column and header scrolled away
          with it — main's overflow-x-hidden couldn't help, because the column
          around it had already been widened. */}
      <div className="flex-1 min-w-0 ml-[72px] flex flex-col min-h-screen">
        <Topbar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden pb-10">
          <Outlet />
        </main>

        {/* ── Persistent bottom bar (Zoho-style) ─────────────────── */}
        <div className="h-[30px] bg-white border-t border-slate-200 fixed bottom-0 left-[72px] right-0 z-40 flex items-center px-4 justify-between text-[13px] text-slate-500 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/help')}
              className="flex items-center gap-1.5 hover:text-slate-800 transition-colors font-medium"
            >
              <HelpCircle size={13} /> Help
            </button>
            <button
              onClick={() => setTourOpen(true)}
              className="flex items-center gap-1.5 hover:text-slate-800 transition-colors font-medium"
            >
              <MapPin size={13} /> Take a Tour
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDarkMode(v => !v)}
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="hover:text-slate-800 transition-colors p-1 rounded hover:bg-slate-100"
            >
              {darkMode ? <Sun size={13} /> : <Moon size={13} />}
            </button>
            <button
              onClick={() => setMuted(v => !v)}
              title={muted ? 'Unmute Sounds' : 'Mute Sounds'}
              className="hover:text-slate-800 transition-colors p-1 rounded hover:bg-slate-100"
            >
              {muted ? <VolumeX size={13} className="text-red-400" /> : <Volume2 size={13} />}
            </button>
          </div>
        </div>
      </div>

      <SmartChat open={smartChatOpen} onClose={() => setSmartChatOpen(false)} />
      {tourOpen && <GuidedTour onClose={() => setTourOpen(false)} />}

      {/* App-level location consent prompt (used by the attendance check-in/out flow) */}
      <GeoPermissionModal />
    </div>
  );
}
