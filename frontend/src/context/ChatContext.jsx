/**
 * ChatContext — single source of truth for the real-time chat.
 *
 * Owns:
 *  • One WebSocket to /ws/chat (auto-reconnect with exponential backoff).
 *  • Contacts state: accepted / incoming / outgoing buckets.
 *  • Per-peer message stores keyed by peer userId.
 *  • Presence + typing maps so the UI can light up indicators.
 *  • Unread count for the topbar badge.
 *
 * Components consume via the `useChat()` hook. The WS is created once on
 * login and kept alive for the entire session — no per-page connection
 * churn. When the JWT changes (refresh token flow), we reconnect.
 */
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import api from '../utils/api';
import { useAuth } from './AuthContext';

const ChatContext = createContext(null);

// Build the WebSocket URL using the same origin as the page. Falls back to
// localhost during dev when window.location.host points at Vite (5173).
// In dev the Vite proxy doesn't forward WS by default, so we point straight
// at the backend on 5000 — adjust the env var if your local backend is elsewhere.
function buildWsUrl(token) {
  if (typeof window === 'undefined') return null;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const isDev = window.location.port === '5173';
  const host  = isDev
    ? (import.meta.env.VITE_BACKEND_WS_HOST || 'localhost:5000')
    : window.location.host;
  return `${proto}://${host}/ws/chat?token=${encodeURIComponent(token)}`;
}

export function ChatProvider({ children }) {
  const { user } = useAuth();

  // Connection state for UI debugging / "reconnecting…" banner if needed.
  const [wsState, setWsState] = useState('idle'); // idle | connecting | open | closed
  const wsRef     = useRef(null);
  const retryRef  = useRef(0);
  const retryT    = useRef(null);

  // Contacts buckets fetched from /api/chat/contacts.
  const [contacts, setContacts] = useState({ accepted: [], incoming: [], outgoing: [] });
  // peerId → array of messages (sorted oldest → newest).
  const [messagesByPeer, setMessagesByPeer] = useState({});
  // peerId → boolean — true if peer has an active socket somewhere.
  const [presence, setPresence] = useState({});
  // peerId → boolean — transient typing indicator.
  const [typing, setTyping] = useState({});
  // For the topbar badge — total unread across every thread, sender ≠ me.
  const [unreadTotal, setUnreadTotal] = useState(0);

  const refreshContacts = useCallback(async () => {
    try {
      const r = await api.get('/chat/contacts');
      setContacts(r.data.data);
      // Seed presence from server-side flag — WS events refine it after.
      const next = {};
      for (const c of r.data.data.accepted) next[c.id] = !!c.online;
      setPresence(p => ({ ...p, ...next }));
      const total = (r.data.data.accepted || []).reduce((n, c) => n + (c.unreadCount || 0), 0);
      setUnreadTotal(total);
    } catch (err) {
      console.error('Failed to load chat contacts', err);
    }
  }, []);

  // ── WebSocket lifecycle ────────────────────────────────────────────────
  // Connect once we have a logged-in user. Reconnect with backoff if the
  // socket drops (network blip, server restart, browser tab woken up).
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('nxt_token');
    if (!token) return;

    let cancelled = false;

    const connect = () => {
      const url = buildWsUrl(token);
      if (!url) return;
      setWsState('connecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (cancelled) { ws.close(); return; }
        retryRef.current = 0;
        setWsState('open');
        // Pull contacts fresh on (re)connect so we don't show stale presence
        // or miss any messages that arrived while disconnected.
        refreshContacts();
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (!msg || typeof msg !== 'object') return;
        handleServerEvent(msg);
      });

      ws.addEventListener('close', () => {
        wsRef.current = null;
        setWsState('closed');
        if (cancelled) return;
        // Exponential backoff capped at 30 s. Without a cap, sleeping laptops
        // could come back to a 10-min wait.
        const delay = Math.min(30_000, 500 * Math.pow(2, retryRef.current++));
        retryT.current = setTimeout(connect, delay);
      });

      ws.addEventListener('error', () => {
        // 'error' fires before 'close' — let close drive the retry, don't
        // double up. Just log for visibility.
        // eslint-disable-next-line no-console
        console.warn('Chat WS error');
      });
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryT.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
        wsRef.current = null;
      }
      setWsState('idle');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);

  // ── Server → client event dispatch ─────────────────────────────────────
  const handleServerEvent = useCallback((evt) => {
    switch (evt.type) {
      case 'message': {
        const m = evt.message;
        // Self-echoes come back when our own send fans out; we've already
        // inserted via sendMessage so just skip.
        if (m.senderId === user?._id) break;
        const peerId = m.senderId;
        setMessagesByPeer(prev => {
          const list = prev[peerId] || [];
          if (list.some(x => x.id === m.id)) return prev; // belt-and-braces de-dup
          return { ...prev, [peerId]: [...list, m] };
        });
        setContacts(c => bumpUnread(c, peerId, m));
        setUnreadTotal(n => n + 1);
        break;
      }
      case 'presence':
        setPresence(p => ({ ...p, [evt.userId]: evt.status === 'online' }));
        break;
      case 'typing':
        setTyping(t => ({ ...t, [evt.userId]: !!evt.isTyping }));
        // Auto-clear after 5 s in case the peer disconnects mid-typing.
        if (evt.isTyping) {
          setTimeout(() => setTyping(t => ({ ...t, [evt.userId]: false })), 5000);
        }
        break;
      case 'read':
        // Mark messages I sent to evt.by as read. We don't know exact ids,
        // but updating the whole thread is fine.
        setMessagesByPeer(prev => {
          const list = prev[evt.by];
          if (!list) return prev;
          return { ...prev, [evt.by]: list.map(m => m.readAt ? m : { ...m, readAt: evt.at }) };
        });
        break;
      case 'connection-request':
      case 'connection-accepted':
        refreshContacts();
        break;
      default:
        break;
    }
  // user._id is stable per login; ignoring the linter to avoid an early-return loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);

  // ── API surface ────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (peerId, { before } = {}) => {
    const params = before ? `?before=${encodeURIComponent(before)}&limit=50` : '?limit=50';
    const r = await api.get(`/chat/threads/${peerId}/messages${params}`);
    // Server returns newest-first — reverse so the UI can render oldest-first.
    const page = [...r.data.data].reverse();
    setMessagesByPeer(prev => {
      const existing = prev[peerId] || [];
      // Merge + de-dup by id, preserving order.
      const seen = new Set(existing.map(x => x.id));
      const merged = [...page.filter(x => !seen.has(x.id)), ...existing];
      return { ...prev, [peerId]: merged };
    });
    return page;
  }, []);

  const sendMessage = useCallback(async (peerId, content) => {
    if (!content || !content.trim()) return null;
    const r = await api.post(`/chat/threads/${peerId}/messages`, { content: content.trim() });
    const msg = r.data.data;
    // Insert the saved message into local state directly. The WS self-echo
    // for our own sends is ignored in handleServerEvent, so there's no race
    // and no duplicate.
    setMessagesByPeer(prev => {
      const list = prev[peerId] || [];
      if (list.some(x => x.id === msg.id)) return prev;
      return { ...prev, [peerId]: [...list, msg] };
    });
    setContacts(c => ({
      ...c,
      accepted: c.accepted.map(x => x.id === peerId
        ? { ...x, lastMessage: msg.content, lastMessageAt: msg.createdAt }
        : x),
    }));
    return msg;
  }, []);

  const markRead = useCallback(async (peerId) => {
    await api.post(`/chat/threads/${peerId}/read`).catch(() => {});
    // Reduce local unread immediately so the badge updates without waiting
    // for the next contacts refresh.
    setContacts(c => clearUnread(c, peerId));
    setUnreadTotal(n => {
      const found = (contacts.accepted || []).find(x => x.id === peerId);
      return Math.max(0, n - (found?.unreadCount || 0));
    });
  }, [contacts.accepted]);

  const sendTyping = useCallback((peerId, isTyping) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing', to: peerId, isTyping: !!isTyping }));
    }
  }, []);

  const searchEmployees = useCallback(async (q) => {
    if (!q || !q.trim()) return [];
    const r = await api.get(`/chat/search?q=${encodeURIComponent(q.trim())}`);
    return r.data.data;
  }, []);

  const sendConnectionRequest = useCallback(async (peerId) => {
    await api.post(`/chat/connect/${peerId}`);
    refreshContacts();
  }, [refreshContacts]);

  const acceptConnection = useCallback(async (peerId) => {
    await api.post(`/chat/connect/${peerId}/accept`);
    refreshContacts();
  }, [refreshContacts]);

  const declineConnection = useCallback(async (peerId) => {
    await api.post(`/chat/connect/${peerId}/decline`);
    refreshContacts();
  }, [refreshContacts]);

  const cancelRequest = useCallback(async (peerId) => {
    await api.delete(`/chat/connect/${peerId}`);
    refreshContacts();
  }, [refreshContacts]);

  // Initial contacts load (in case WS open arrives slowly).
  useEffect(() => { if (user) refreshContacts(); }, [user, refreshContacts]);

  return (
    <ChatContext.Provider value={{
      wsState,
      contacts, refreshContacts,
      messagesByPeer, loadMessages, sendMessage, markRead, sendTyping,
      presence, typing,
      unreadTotal,
      searchEmployees,
      sendConnectionRequest, acceptConnection, declineConnection, cancelRequest,
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
};

// ── helpers ───────────────────────────────────────────────────────────────

// Server doesn't tell us who the "other side" is when WE sent a message,
// but the API payload includes threadId only. We use a different trick:
// the caller of sendMessage knows the peer, and the WS echo for our own
// sends has senderId === me — we identify the peer from messagesByPeer.
// To keep things simple, we just *skip* the WS echo for our own sends here
// by returning null and letting sendMessage's caller insert it via the
// existing reducer. (See sendMessage above.)
function otherFromThread() { return null; }

function bumpUnread(contacts, peerId, msg) {
  return {
    ...contacts,
    accepted: contacts.accepted.map(c => c.id === peerId
      ? { ...c, lastMessage: msg.content, lastMessageAt: msg.createdAt, unreadCount: (c.unreadCount || 0) + 1 }
      : c),
  };
}
function clearUnread(contacts, peerId) {
  return {
    ...contacts,
    accepted: contacts.accepted.map(c => c.id === peerId
      ? { ...c, unreadCount: 0 }
      : c),
  };
}
