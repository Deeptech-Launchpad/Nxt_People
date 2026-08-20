import React, { useEffect, useState } from 'react';
import { CalendarDays, Copy, Check, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

// Subscribing to your own leave calendar.
//
// The URL is the credential — a calendar polls it on its own schedule with no
// session and nobody to prompt — so this says so plainly rather than presenting
// it as an ordinary link. Anyone holding it sees the same leave you do, which
// is why re-issuing exists and why the copy button is the only way it leaves
// the page.

export default function CalendarSubscribe() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);

  const load = () => api.get('/calendar')
    .then(r => setState(r.data.data))
    .catch(() => setState({ enabled: false, error: true }));

  useEffect(() => { load(); }, []);

  const copy = async (url, which) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access is refused in some browsers and over plain http.
      // Selecting the text by hand still works, so say that instead of failing.
      toast.error('Could not copy — select the link and copy it manually');
    }
  };

  const enable = async () => {
    setBusy(true);
    try { await api.post('/calendar'); await load(); toast.success('Calendar link created'); }
    catch (e) { toast.error(e.response?.data?.message || 'Could not create the link'); }
    finally { setBusy(false); }
  };

  const reissue = async () => {
    if (!window.confirm('Create a new link? The current one stops working immediately.')) return;
    setBusy(true);
    try { await api.post('/calendar'); await load(); toast.success('New link created — the old one no longer works'); }
    catch (e) { toast.error(e.response?.data?.message || 'Could not create a new link'); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    if (!window.confirm('Turn off the calendar? The link stops working immediately.')) return;
    setBusy(true);
    try { await api.delete('/calendar'); await load(); toast.success('Calendar turned off'); }
    catch (e) { toast.error(e.response?.data?.message || 'Could not turn it off'); }
    finally { setBusy(false); }
  };

  if (!state) return null;

  const Row = ({ label, url, which }) => (
    <div className="mt-3">
      <p className="text-[12.5px] font-medium text-slate-600 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <input
          readOnly value={url} onFocus={e => e.target.select()}
          className="flex-1 text-[12.5px] font-mono rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-slate-600"
        />
        <button
          onClick={() => copy(url, which)}
          className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-md text-[13px] font-medium text-slate-600"
        >
          {copied === which ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          {copied === which ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start gap-2.5">
        <CalendarDays size={18} className="text-slate-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="text-[15px] font-semibold text-slate-800">Add your leave to your calendar</h3>
          <p className="text-[13px] text-slate-500 mt-1 max-w-[560px]">
            Your approved leave and the company holidays, in Google Calendar, Outlook, or
            anything that reads a calendar link. It updates on its own — your calendar
            checks every few hours.
          </p>

          {!state.enabled ? (
            <button
              onClick={enable} disabled={busy}
              className="mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg text-[14px] font-semibold"
            >
              {busy ? 'Creating…' : 'Create my calendar link'}
            </button>
          ) : (
            <>
              <Row label="Your leave and company holidays" url={state.url} which="mine" />
              {state.teamUrl && (
                <Row label="Your team's leave" url={state.teamUrl} which="team" />
              )}

              <div className="mt-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-[560px]">
                Treat this link like a password. It needs no sign-in, so anyone who has it can
                see the same leave you can. If you share it by accident, create a new one —
                that stops the old link working straight away.
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={reissue} disabled={busy}
                  className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-md text-[13px] font-medium text-slate-600"
                >
                  <RefreshCw size={14} /> Create a new link
                </button>
                <button
                  onClick={disable} disabled={busy}
                  className="flex items-center gap-1.5 border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-md text-[13px] font-medium"
                >
                  <X size={14} /> Turn off
                </button>
              </div>

              <details className="mt-3">
                <summary className="text-[12.5px] text-slate-500 cursor-pointer hover:text-slate-700">
                  How do I add it?
                </summary>
                <div className="text-[12.5px] text-slate-500 mt-2 space-y-1 max-w-[560px]">
                  <p><strong>Google Calendar:</strong> Other calendars → From URL → paste the link.</p>
                  <p><strong>Outlook:</strong> Add calendar → Subscribe from web → paste the link.</p>
                  <p><strong>Apple Calendar:</strong> File → New Calendar Subscription → paste the link.</p>
                  <p className="pt-1">
                    Each of them decides how often to check, usually every few hours, so a new
                    leave may take a little while to appear.
                  </p>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
