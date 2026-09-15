import { useSyncExternalStore } from 'react';

/* Counts shown beside an Operations workspace's tabs in the navy bar.
 *
 * The tabs are drawn by Topbar, but the numbers belong to the page underneath
 * it — Leave Approvals knows how many requests sit in each queue, the navy bar
 * does not. So the page publishes its counts here, keyed by the workspace's
 * base path, and Topbar reads them back for that same base. A page that never
 * publishes leaves its tabs without badges, which is what every other
 * workspace wants. */

const EMPTY = Object.freeze({});
const badges = new Map();
const listeners = new Set();

const notify = () => listeners.forEach(l => l());

export function setWorkspaceBadges(base, counts) {
  badges.set(base, counts ? { ...counts } : EMPTY);
  notify();
}

export function clearWorkspaceBadges(base) {
  if (badges.delete(base)) notify();
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** @returns {Record<string, number>} tab id -> count, for one workspace base. */
export function useWorkspaceBadges(base) {
  return useSyncExternalStore(subscribe, () => (base && badges.get(base)) || EMPTY);
}
