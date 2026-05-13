import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import SmartChat from '../SmartChat';
import { MessageSquare, Users, Moon, Sun, Volume2, VolumeX, Search } from 'lucide-react';

export default function Layout() {
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('nxt-dark') === '1');
  const [muted, setMuted] = useState(false);
  const [smartChatOpen, setSmartChatOpen] = useState(false);

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
      <div className="flex-1 ml-[72px] flex flex-col min-h-screen">
        <Topbar />
        <main className="flex-1 overflow-auto pb-10">
          <Outlet />
        </main>

        {/* ── Persistent bottom bar (Zoho-style) ─────────────────── */}
        <div className="h-[30px] bg-white border-t border-slate-200 fixed bottom-0 left-[72px] right-0 z-40 flex items-center px-4 justify-between text-[11.5px] text-slate-500 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/chat')}
              className="flex items-center gap-1.5 hover:text-slate-800 transition-colors font-medium"
            >
              <MessageSquare size={13} /> Chats
            </button>
            <button
              onClick={() => navigate('/directory')}
              className="flex items-center gap-1.5 hover:text-slate-800 transition-colors font-medium"
            >
              <Users size={13} /> Contacts
            </button>
            <span className="text-slate-300">|</span>
            <button
              onClick={() => setSmartChatOpen(true)}
              className="flex items-center gap-1.5 text-slate-400 hover:text-slate-800 transition-colors text-[11px]"
              title="Open Smart Chat (Ctrl+Space)"
            >
              <Search size={12} />
              <span>Here is your Smart Chat</span>
              <kbd className="ml-1 hidden sm:inline-flex items-center gap-1 px-1.5 py-[1px] rounded border border-slate-200 bg-slate-50 text-slate-500 font-mono text-[10px]">
                Ctrl + Space
              </kbd>
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
    </div>
  );
}
