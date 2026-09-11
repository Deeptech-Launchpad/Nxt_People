import React, { useState } from 'react';
import { X, GripVertical } from 'lucide-react';
import { WIDGET_BY_KEY } from './widgets';
import { insertKey, dropSide, usePrefersReducedMotion } from './dnd';

const Switch = ({ on, onClick, label }) => (
  <button
    onClick={onClick} role="switch" aria-checked={on} aria-label={label}
    className={`w-10 h-[22px] rounded-full transition-colors relative flex-shrink-0 ${on ? 'bg-blue-600' : 'bg-slate-300'}`}
  >
    <span className={`absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full transition-all ${on ? 'left-[20px]' : 'left-0.5'}`} />
  </button>
);

export default function CustomizeWidgetsPanel({ order, hidden, onOrderChange, onToggle, onClose }) {
  const reduced = usePrefersReducedMotion();
  const [dragKey, setDragKey] = useState(null);
  const [over, setOver] = useState(null);

  const finish = () => { setDragKey(null); setOver(null); };

  const handleDrop = (e, key) => {
    e.preventDefault();
    onOrderChange(insertKey(order, dragKey, key, dropSide(e, 'y')));
    finish();
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative bg-white w-full max-w-[340px] h-full shadow-2xl border-l border-slate-200 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">Customize widgets</p>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <p className="px-5 pt-4 pb-2 text-[13px] font-bold text-slate-500 uppercase tracking-wider">My Widgets</p>

          {order.map(key => {
            const w = WIDGET_BY_KEY[key];
            if (!w) return null;
            const on = !hidden.includes(key);
            const isOver = over?.key === key && dragKey && dragKey !== key;
            return (
              <div
                key={key}
                draggable
                onDragStart={e => { setDragKey(key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); }}
                onDragOver={e => { e.preventDefault(); if (dragKey && dragKey !== key) setOver({ key, side: dropSide(e, 'y') }); }}
                onDrop={e => handleDrop(e, key)}
                onDragEnd={finish}
                className={`relative flex items-center gap-3 px-5 py-2.5 border-b border-slate-100 bg-white ${reduced ? '' : 'transition-colors'} ${dragKey === key ? 'opacity-40' : 'hover:bg-slate-50'}`}
              >
                {isOver && (
                  <span className={`absolute left-0 right-0 h-[3px] bg-blue-600 ${over.side === 'before' ? 'top-0' : 'bottom-0'}`} />
                )}
                <GripVertical size={15} className="text-slate-300 cursor-grab flex-shrink-0" />
                <p className="flex-1 text-[14px] text-slate-700 truncate">{w.title}</p>
                <Switch on={on} onClick={() => onToggle(key)} label={w.title} />
              </div>
            );
          })}

          <p className="px-5 py-4 text-[12px] text-slate-400 leading-snug">
            Drag a row to reorder, or drag the cards on the page. Changes are saved to your profile.
          </p>
        </div>
      </div>
    </div>
  );
}
