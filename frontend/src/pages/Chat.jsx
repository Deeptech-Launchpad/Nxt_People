import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { MessageCircle, Send } from 'lucide-react';

export default function Chat() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    // Load all employees as a quick directory for chat
    api.get('/employees').then(r => setUsers(r.data.data)).catch(()=>{});
  }, []);

  const loadMessages = async (u) => {
    setActiveUser(u);
    try {
      const convRes = await api.post('/messages/conversations', { participantId: u._id, type: 'direct' });
      const convId = convRes.data.data._id;
      setActiveUser(prev => ({ ...prev, convId }));
      const msgRes = await api.get(`/messages/conversations/${convId}/messages`);
      // Backend returns messages in descending order, we need to reverse them for display
      setMessages(msgRes.data.data.reverse());
    } catch (e) {
      setMessages([]);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if(!input.trim() || !activeUser || !activeUser.convId) return;
    try {
      const res = await api.post(`/messages/conversations/${activeUser.convId}/messages`, { content: input });
      setMessages([...messages, res.data.data]);
      setInput('');
    } catch (err) {}
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 h-[80vh] flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-1/3 border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-100 font-semibold flex items-center gap-2 text-slate-800">
          <MessageCircle className="text-brand-500" /> Internal Chat
        </div>
        <div className="flex-1 overflow-y-auto">
          {users.map(u => u._id !== user._id && (
            <div key={u._id} onClick={() => loadMessages(u)} 
              className={`p-4 border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${activeUser?._id === u._id ? 'bg-brand-50' : ''}`}>
              <p className="font-medium text-slate-800">{u.firstName} {u.lastName}</p>
              <p className="text-xs text-slate-500">{u.department}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-slate-50">
        {activeUser ? (
          <>
            <div className="p-4 bg-white border-b border-slate-200 font-semibold text-slate-800">
              {activeUser.firstName} {activeUser.lastName}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map(m => {
                const isMe = m.sender._id === user._id;
                return (
                  <div key={m._id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] p-3 rounded-2xl ${isMe ? 'bg-brand-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'}`}>
                      {m.content}
                    </div>
                  </div>
                )
              })}
            </div>
            <form onSubmit={handleSend} className="p-4 bg-white border-t border-slate-200 flex gap-2">
              <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Type a message..." className="flex-1 border border-slate-200 rounded-full px-4 py-2 focus:outline-none focus:border-brand-500" />
              <button type="submit" className="bg-brand-600 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-brand-500 transition"><Send size={18}/></button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">Select a user to start chatting</div>
        )}
      </div>
    </div>
  );
}
