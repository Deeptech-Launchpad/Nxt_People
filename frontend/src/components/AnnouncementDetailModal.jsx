import React from 'react';
import { X, Pin } from 'lucide-react';
import { PhotoAvatar } from './ui';
import { renderRichText } from '../utils/richText';

const dmy = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const when = (dateStr) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 30) return dmy(dateStr);
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hrs > 0) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  if (mins > 0) return `${mins} min ago`;
  return 'Just now';
};

/**
 * The full text of one announcement.
 *
 * Shared by the Announcements page and the Home dashboard card because they
 * are the same thing read from two places — the card used to navigate away to
 * the list to show a message it already had in hand.
 */
export default function AnnouncementDetailModal({ announcement: a, onClose }) {
  if (!a) return null;
  const poster = a.postedBy || {};

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1f2937] rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-100 dark:border-[#374151]">
          <div className="flex items-start gap-3 min-w-0">
            <PhotoAvatar photoUrl={poster.photoUrl} firstName={poster.firstName} lastName={poster.lastName}
                         className="w-10 h-10" textClassName="text-xs" />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                {poster.firstName} {poster.lastName}
              </p>
              <p className="text-[12px] text-slate-400">{when(a.createdAt)}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-[#374151] hover:bg-slate-200 text-slate-600 dark:text-slate-300 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          <h3 className="font-display font-bold text-xl text-slate-800 dark:text-slate-100 mb-3">{a.title}</h3>
          <div
            className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 space-y-1 [&_a]:text-brand-600"
            dangerouslySetInnerHTML={{ __html: renderRichText(a.body) }}
          />
        </div>

        <div className="px-6 py-3 border-t border-slate-100 dark:border-[#374151] text-[12px] text-slate-400 flex items-center gap-4 flex-wrap">
          <span>Expiry: {a.expiresAt ? dmy(a.expiresAt) : 'Nil'}</span>
          {a.isPinned && (
            <span className="flex items-center gap-1">
              <Pin size={11} /> Pinned{a.pinnedUntil ? ` until ${dmy(a.pinnedUntil)}` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
