import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import CustomizeWidgetsPanel from './dashboard/CustomizeWidgetsPanel';
import { insertKey, dropSide, usePrefersReducedMotion } from './dashboard/dnd';
import {
  Card, SOURCES, WIDGET_BY_KEY, DEFAULT_ORDER, DEFAULT_HIDDEN
} from './dashboard/widgets';

const SPAN_CLASS = { 1: '', 2: 'md:col-span-2', 3: 'md:col-span-3' };

/* A saved layout is the person's order, not the registry's, but it also cannot
 * be the whole truth: a widget added after they last customised the page is in
 * the registry and not in their saved order. Their order wins for the keys they
 * chose, and anything new is appended rather than silently dropped. */
function mergeSaved(saved) {
  if (!saved) return { order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN };
  const order = [...saved.order, ...DEFAULT_ORDER.filter(k => !saved.order.includes(k))];
  const added = DEFAULT_ORDER.filter(k => !saved.order.includes(k) && DEFAULT_HIDDEN.includes(k));
  return { order, hidden: [...new Set([...saved.hidden, ...added])] };
}

export default function DashboardWidgets() {
  const { user } = useAuth();
  const reduced = usePrefersReducedMotion();

  const [order, setOrder] = useState(DEFAULT_ORDER);
  const [hidden, setHidden] = useState(DEFAULT_HIDDEN);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const [data, setData] = useState({});
  const [status, setStatus] = useState({});
  const [err, setErr] = useState({});

  const [dragKey, setDragKey] = useState(null);
  const [over, setOver] = useState(null);

  const dirty = useRef(false);
  const requested = useRef(new Set());
  const saveTimer = useRef(null);

  useEffect(() => {
    api.get('/dashboard/layout')
      .then(r => {
        const merged = mergeSaved(r.data?.data);
        setOrder(merged.order);
        setHidden(merged.hidden);
      })
      .catch(() => { /* no saved layout, or the column is not migrated yet — defaults stand */ })
      .finally(() => setLayoutLoaded(true));
  }, []);

  const visible = useMemo(
    () => order.filter(k => WIDGET_BY_KEY[k] && !hidden.includes(k)),
    [order, hidden]
  );
  const visibleFingerprint = visible.join(',');

  /* Fetch what the widgets on screen need and nothing else. A source already
   * requested is never requested again — unhiding a card it feeds reuses the
   * response instead of refetching. */
  useEffect(() => {
    if (!user?._id) return;
    const needed = new Set();
    visible.forEach(k => (WIDGET_BY_KEY[k].sources || []).forEach(s => needed.add(s)));

    needed.forEach(s => {
      if (requested.current.has(s) || !SOURCES[s]) return;
      requested.current.add(s);
      setStatus(p => ({ ...p, [s]: 'loading' }));
      SOURCES[s](user)
        .then(d => {
          setData(p => ({ ...p, [s]: d }));
          setStatus(p => ({ ...p, [s]: 'ready' }));
        })
        .catch(e => {
          setErr(p => ({ ...p, [s]: e.response?.data?.message || 'Could not load this widget.' }));
          setStatus(p => ({ ...p, [s]: 'error' }));
        });
    });
  }, [visibleFingerprint, user?._id]);

  /* Debounced so a drag across five positions is one write, not five. A failed
   * save leaves the page exactly as the person arranged it and says so in the
   * header — losing the arrangement as well would be the worse half of the
   * failure. */
  useEffect(() => {
    if (!layoutLoaded || !dirty.current) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.put('/dashboard/layout', { order, hidden })
        .then(() => setSaveFailed(false))
        .catch(() => setSaveFailed(true));
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [order, hidden, layoutLoaded]);

  const applyOrder = next => { dirty.current = true; setOrder(next); };
  const toggleWidget = key => {
    dirty.current = true;
    setHidden(h => h.includes(key) ? h.filter(k => k !== key) : [...h, key]);
  };

  const endDrag = () => { setDragKey(null); setOver(null); };

  const onCardDrop = (e, key) => {
    e.preventDefault();
    applyOrder(insertKey(order, dragKey, key, dropSide(e, 'x')));
    endDrag();
  };

  return (
    <div className="p-5 bg-[#f8f9fc] min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[17px] font-bold text-slate-800">Dashboard</h2>
          {saveFailed && (
            <p className="text-[12px] text-rose-500 font-medium mt-0.5">
              Couldn't save your layout — it will still look like this until you reload.
            </p>
          )}
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-2 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3.5 py-2 rounded text-[14px] font-medium"
        >
          <SlidersHorizontal size={14} className="text-slate-400" />
          Customize widgets
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded border border-slate-200 shadow-sm p-10 text-center">
          <p className="text-[14px] font-semibold text-slate-800">Every widget is switched off.</p>
          <p className="text-[13px] text-slate-500 mt-1">Turn one back on from Customize widgets.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-min">
          {visible.map(key => {
            const w = WIDGET_BY_KEY[key];
            const isOver = over?.key === key && dragKey && dragKey !== key;
            return (
              <div
                key={key}
                draggable
                onDragStart={e => {
                  setDragKey(key);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', key);
                }}
                onDragOver={e => {
                  e.preventDefault();
                  if (dragKey && dragKey !== key) setOver({ key, side: dropSide(e, 'x') });
                }}
                onDrop={e => onCardDrop(e, key)}
                onDragEnd={endDrag}
                className={`relative ${SPAN_CLASS[w.colSpan] || ''} ${reduced ? '' : 'transition-opacity'} ${dragKey === key ? 'opacity-40' : ''}`}
              >
                {isOver && (
                  <span
                    className={`absolute top-0 bottom-0 w-[3px] bg-blue-600 rounded z-10 ${over.side === 'before' ? '-left-2' : '-right-2'}`}
                    aria-hidden="true"
                  />
                )}
                <Card title={w.title} icon={w.icon} className={`h-full ${w.minHeight || ''}`}>
                  {w.render({ data, status, err, user })}
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {panelOpen && (
        <CustomizeWidgetsPanel
          order={order.filter(k => WIDGET_BY_KEY[k])}
          hidden={hidden}
          onOrderChange={applyOrder}
          onToggle={toggleWidget}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}
