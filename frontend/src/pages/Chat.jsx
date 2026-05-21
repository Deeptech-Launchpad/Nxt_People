import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Search, UserPlus, Check, X, Clock, Circle, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};
const fmtDay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const yest  = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString())  return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

function Avatar({ name, photoUrl, online, size = 40 }) {
  const initials = (name || '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {photoUrl ? (
        <img src={photoUrl} alt="" className="w-full h-full rounded-full object-cover border border-slate-200" />
      ) : (
        <div className="w-full h-full rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-bold border border-slate-200"
             style={{ fontSize: Math.max(11, size * 0.35) }}>
          {initials || '?'}
        </div>
      )}
      {online && (
        <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full" />
      )}
    </div>
  );
}

export default function Chat() {
  const { user } = useAuth();
  const {
    wsState, contacts,
    messagesByPeer, loadMessages, sendMessage, markRead, sendTyping,
    presence, typing,
    searchEmployees, sendConnectionRequest, acceptConnection, declineConnection, cancelRequest,
  } = useChat();

  const [params, setParams] = useSearchParams();
  const initialPeerFromUrl = params.get('user');

  const [activePeer, setActivePeer] = useState(null);  // contact object
  const [draft, setDraft]           = useState('');
  const [searchQ, setSearchQ]       = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching]   = useState(false);
  const messagesScrollRef = useRef(null);
  const typingDebounce    = useRef(null);

  // Open a specific contact when /chat?user=:id lands on the page. If we
  // don't have a connection yet, fire off a request so the recipient sees
  // it. Either way, switch the URL search-param away so a refresh doesn't
  // re-fire the request.
  const autoSent = useRef(false);
  useEffect(() => {
    if (!initialPeerFromUrl || activePeer || autoSent.current) return;
    const match = contacts.accepted.find(c => c.id === initialPeerFromUrl);
    if (match) {
      setActivePeer(match);
    } else if (
      !contacts.outgoing.some(c => c.id === initialPeerFromUrl) &&
      !contacts.incoming.some(c => c.id === initialPeerFromUrl)
    ) {
      autoSent.current = true;
      sendConnectionRequest(initialPeerFromUrl).catch(console.error);
    }
  }, [initialPeerFromUrl, contacts, activePeer, sendConnectionRequest]);

  // Load history + mark-read whenever the active peer changes.
  useEffect(() => {
    if (!activePeer) return;
    loadMessages(activePeer.id).catch(console.error);
    markRead(activePeer.id);
    // Reflect in URL so a refresh keeps the conversation open.
    setParams({ user: activePeer.id }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePeer?.id]);

  const activeMessages = activePeer ? (messagesByPeer[activePeer.id] || []) : [];

  // Auto-scroll to the newest message when the active thread changes or a
  // new message arrives.
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeMessages.length, activePeer?.id]);

  // Debounced search against /api/chat/search.
  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { setSearchResults(await searchEmployees(searchQ)); }
      finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [searchQ, searchEmployees]);

  // Group consecutive messages by day for the "Today / Yesterday / Date" separators.
  const groupedMessages = useMemo(() => {
    const out = [];
    let lastDay = '';
    for (const m of activeMessages) {
      const day = fmtDay(m.createdAt);
      if (day !== lastDay) { out.push({ daySep: day, key: `sep-${day}-${m.id}` }); lastDay = day; }
      out.push({ msg: m, key: m.id });
    }
    return out;
  }, [activeMessages]);

  const handleSend = (e) => {
    e?.preventDefault?.();
    if (!activePeer || !draft.trim()) return;
    sendMessage(activePeer.id, draft).catch(console.error);
    setDraft('');
    sendTyping(activePeer.id, false);
  };

  const handleDraftChange = (e) => {
    setDraft(e.target.value);
    if (!activePeer) return;
    sendTyping(activePeer.id, true);
    clearTimeout(typingDebounce.current);
    // Auto-clear typing on the peer's side if user pauses.
    typingDebounce.current = setTimeout(() => sendTyping(activePeer.id, false), 2500);
  };

  const startConversation = async (emp) => {
    // If we're already connected, just open the conversation. Otherwise
    // send a request and surface a toast-style hint.
    if (emp.connectionStatus === 'accepted') {
      const match = contacts.accepted.find(c => c.id === emp.id);
      if (match) setActivePeer(match);
      else setSearchQ('');
      return;
    }
    await sendConnectionRequest(emp.id);
    setSearchQ('');
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 flex overflow-hidden" style={{ height: 'calc(100vh - 9rem)' }}>
      {/* ───────── Left sidebar: contacts + requests + search ───────── */}
      <aside className="w-[340px] border-r border-slate-200 flex flex-col">
        <div className="p-3 border-b border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle size={16} className="text-blue-600" />
            <h2 className="text-[14px] font-bold text-slate-800">Chat</h2>
            <span className={`ml-auto text-[10.5px] font-medium px-2 py-0.5 rounded-full ${
              wsState === 'open' ? 'bg-emerald-50 text-emerald-700'
              : wsState === 'connecting' ? 'bg-amber-50 text-amber-700'
              : 'bg-slate-100 text-slate-500'
            }`}>
              {wsState === 'open' ? '● live' : wsState === 'connecting' ? '○ connecting' : '○ offline'}
            </span>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search colleagues to connect…"
              className="w-full pl-8 pr-3 py-1.5 text-[12.5px] border border-slate-200 rounded-md focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Search results take priority when query is non-empty. */}
          {searchQ.trim() ? (
            <div className="p-2">
              <p className="px-2 py-1 text-[10.5px] font-semibold text-slate-400 uppercase tracking-wide">
                {searching ? 'Searching…' : `${searchResults.length} result(s)`}
              </p>
              {searchResults.map(r => (
                <div key={r.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-slate-50">
                  <Avatar name={`${r.firstName} ${r.lastName}`} photoUrl={r.photoUrl} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-slate-800 truncate">
                      {r.firstName} {r.lastName}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">{r.designation || r.department || ''}</p>
                  </div>
                  {r.connectionStatus === 'accepted' && (
                    <button onClick={() => startConversation(r)}
                            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700">
                      Message
                    </button>
                  )}
                  {r.connectionStatus === 'pending' && (
                    <span className="text-[11px] text-amber-600 flex items-center gap-1"><Clock size={11}/>Pending</span>
                  )}
                  {!r.connectionStatus && (
                    <button onClick={() => startConversation(r)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded">
                      <UserPlus size={11}/> Connect
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Incoming connection requests */}
              {contacts.incoming.length > 0 && (
                <div className="p-2 border-b border-slate-100">
                  <p className="px-2 py-1 text-[10.5px] font-semibold text-slate-400 uppercase tracking-wide">
                    Requests ({contacts.incoming.length})
                  </p>
                  {contacts.incoming.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-slate-50">
                      <Avatar name={`${c.firstName} ${c.lastName}`} photoUrl={c.photoUrl} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-slate-800 truncate">
                          {c.firstName} {c.lastName}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">wants to chat</p>
                      </div>
                      <button onClick={() => acceptConnection(c.id)} title="Accept"
                              className="w-7 h-7 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center">
                        <Check size={13}/>
                      </button>
                      <button onClick={() => declineConnection(c.id)} title="Decline"
                              className="w-7 h-7 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 flex items-center justify-center">
                        <X size={13}/>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Outgoing pending requests */}
              {contacts.outgoing.length > 0 && (
                <div className="p-2 border-b border-slate-100">
                  <p className="px-2 py-1 text-[10.5px] font-semibold text-slate-400 uppercase tracking-wide">
                    Sent ({contacts.outgoing.length})
                  </p>
                  {contacts.outgoing.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-slate-50">
                      <Avatar name={`${c.firstName} ${c.lastName}`} photoUrl={c.photoUrl} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-slate-800 truncate">
                          {c.firstName} {c.lastName}
                        </p>
                        <p className="text-[11px] text-amber-600 truncate flex items-center gap-1"><Clock size={10}/>Awaiting accept</p>
                      </div>
                      <button onClick={() => cancelRequest(c.id)} title="Cancel"
                              className="text-[11px] text-slate-500 hover:text-red-600">
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Accepted contacts */}
              <div className="p-2">
                <p className="px-2 py-1 text-[10.5px] font-semibold text-slate-400 uppercase tracking-wide">
                  Conversations ({contacts.accepted.length})
                </p>
                {contacts.accepted.length === 0 && (
                  <p className="px-2 py-3 text-[12px] text-slate-400 italic">
                    Search above to connect with a colleague.
                  </p>
                )}
                {contacts.accepted.map(c => {
                  const isActive = activePeer?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActivePeer(c)}
                      className={`w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors ${
                        isActive ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <Avatar name={`${c.firstName} ${c.lastName}`} photoUrl={c.photoUrl} online={presence[c.id]} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-slate-800 truncate">
                          {c.firstName} {c.lastName}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {typing[c.id] ? <span className="text-blue-600 italic">typing…</span> : (c.lastMessage || c.designation || '')}
                        </p>
                      </div>
                      {c.unreadCount > 0 && !isActive && (
                        <span className="text-[10.5px] font-bold text-white bg-blue-600 px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                          {c.unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ───────── Right pane: conversation ───────── */}
      <section className="flex-1 flex flex-col bg-slate-50">
        {activePeer ? (
          <>
            <header className="flex items-center gap-3 px-5 py-3 bg-white border-b border-slate-200">
              <Avatar name={`${activePeer.firstName} ${activePeer.lastName}`} photoUrl={activePeer.photoUrl} online={presence[activePeer.id]} size={36} />
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-slate-800 truncate">{activePeer.firstName} {activePeer.lastName}</p>
                <p className="text-[11.5px] text-slate-500 truncate flex items-center gap-1.5">
                  {typing[activePeer.id] ? (
                    <span className="text-blue-600 italic">typing…</span>
                  ) : presence[activePeer.id] ? (
                    <><Circle size={6} className="fill-emerald-500 text-emerald-500"/> Online</>
                  ) : (
                    'Offline'
                  )}
                </p>
              </div>
            </header>

            <div ref={messagesScrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {groupedMessages.map(item => {
                if (item.daySep) {
                  return (
                    <div key={item.key} className="flex justify-center my-3">
                      <span className="text-[11px] text-slate-500 bg-white border border-slate-200 px-3 py-0.5 rounded-full">
                        {item.daySep}
                      </span>
                    </div>
                  );
                }
                const m = item.msg;
                const isMe = m.senderId === user._id;
                return (
                  <div key={item.key} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] px-3 py-2 rounded-2xl ${
                      isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                    }`}>
                      <p className="text-[13px] whitespace-pre-wrap break-words">{m.content}</p>
                      <p className={`text-[10px] mt-0.5 ${isMe ? 'text-blue-100' : 'text-slate-400'}`}>
                        {fmtTime(m.createdAt)}
                        {isMe && m.readAt && <span className="ml-1">· Read</span>}
                      </p>
                    </div>
                  </div>
                );
              })}
              {groupedMessages.length === 0 && (
                <p className="text-center text-[12.5px] text-slate-400 italic py-10">
                  No messages yet. Say hi 👋
                </p>
              )}
            </div>

            <form onSubmit={handleSend} className="flex items-center gap-2 px-4 py-3 bg-white border-t border-slate-200">
              <input
                value={draft}
                onChange={handleDraftChange}
                placeholder={`Message ${activePeer.firstName}…`}
                className="flex-1 px-4 py-2 text-[13px] border border-slate-200 rounded-full focus:outline-none focus:border-blue-400"
              />
              <button type="submit" disabled={!draft.trim()}
                      className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-full flex items-center justify-center transition-colors">
                <Send size={15}/>
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center px-6">
            <MessageCircle size={48} className="mb-3 opacity-40" />
            <p className="text-[14px] font-medium">Pick a conversation</p>
            <p className="text-[12.5px] mt-1 max-w-xs">
              Or search for a colleague above to send your first connection request.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
