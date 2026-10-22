import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { MoreHorizontal, FileSpreadsheet, FileText, ImageIcon } from 'lucide-react';
import api from '../../utils/api';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// First/last day of a given month, as 'YYYY-MM-DD' — the same
// new Date(y, m, 0)-for-the-last-day trick HrAttendanceDashboard.jsx's own
// lastOfMonth() uses, inlined here rather than imported so this component
// stays self-contained (it's two lines).
function monthRange(year, month1to12) {
  const ymd = (d) => d.toLocaleDateString('en-CA');
  return { from: ymd(new Date(year, month1to12 - 1, 1)), to: ymd(new Date(year, month1to12, 0)) };
}

/* The "⋯" menu on every chart card: Download Excel / CSV (built server-side
 * by GET /hr-attendance-dashboard/export, using the SAME applied filters as
 * the chart itself) and Download Image / PNG (built entirely client-side,
 * straight from the chart's own rendered SVG — no server round trip, no new
 * library: serialize the SVG, draw it onto a canvas, read the canvas back as
 * a PNG blob).
 *
 * Excel/CSV also carry their own Month + Year pickers, independent of the
 * dashboard's own Date filter — the export endpoint already takes any
 * from/to it's given (see getRange() in the backend route), so this needs no
 * backend change: it just lets a download ask for a specific month without
 * first changing what the whole dashboard is showing. Defaults to whichever
 * month the dashboard's applied range pointed to when this card first
 * mounted, then stays independent — picking a different month to export
 * doesn't get reset by it. PNG has no month picker: it is a screenshot of
 * whatever the chart is showing right now, not a data export, so a "month"
 * for it wouldn't mean anything without also changing the chart on screen,
 * which is out of scope here.
 *
 * Keyboard/click-outside: Esc or a click outside closes the menu and returns
 * focus to the "⋯" button; each item is a real <button role="menuitem">. */
export default function ChartMenu({ chart, params, chartRef, fileLabel }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null); // 'xlsx' | 'csv' | 'png' | null
  const [error, setError] = useState(null);
  const [expMonth, setExpMonth] = useState(() => {
    const d = params?.to ? new Date(`${params.to}T00:00:00`) : new Date();
    return d.getMonth() + 1;
  });
  const [expYear, setExpYear] = useState(() => {
    const d = params?.to ? new Date(`${params.to}T00:00:00`) : new Date();
    return d.getFullYear();
  });
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const yearOptions = (() => {
    const base = new Date().getFullYear();
    const years = Array.from({ length: 6 }, (_, i) => base - i);
    return years.includes(expYear) ? years : [expYear, ...years];
  })();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const downloadFile = async (format) => {
    setBusy(format);
    setError(null);
    try {
      const { from, to } = monthRange(expYear, expMonth);
      const res = await api.get('/hr-attendance-dashboard/export', {
        params: { chart, format, ...params, from, to },
        responseType: 'blob',
      });
      const cd = res.headers['content-disposition'] || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `${fileLabel}.${format}`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (err) {
      const message = 'Could not prepare that file. Please try again.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  // SVG -> <img> -> <canvas> -> PNG blob. Works for any Recharts chart since
  // ResponsiveContainer always renders one <svg> as the chart's root.
  const downloadPng = () => {
    setBusy('png');
    setError(null);
    try {
      const svg = chartRef.current?.querySelector('svg');
      if (!svg) throw new Error('No chart to export yet.');
      const rect = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(rect.width));
      clone.setAttribute('height', String(rect.height));
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#ffffff');
      clone.insertBefore(bg, clone.firstChild);
      const svgStr = new XMLSerializer().serializeToString(clone);
      const svgUrl = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = () => {
        const scale = 2; // sharper than the on-screen 1x size
        const canvas = document.createElement('canvas');
        canvas.width = rect.width * scale;
        canvas.height = rect.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        URL.revokeObjectURL(svgUrl);
        canvas.toBlob((blob) => {
          if (!blob) { setBusy(null); toast.error('Could not create the image.'); return; }
          const pngUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = pngUrl; a.download = `${fileLabel}.png`;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(pngUrl);
          setBusy(null);
          setOpen(false);
        }, 'image/png');
      };
      img.onerror = () => { setBusy(null); toast.error('Could not create the image.'); };
      img.src = svgUrl;
    } catch (err) {
      setBusy(null);
      const message = 'Could not create the image.';
      setError(message);
      toast.error(message);
    }
  };

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={btnRef} type="button" onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu" aria-expanded={open} title="Chart options"
        className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Chart download options"
          className="absolute right-0 mt-1 w-60 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-30">
          <div className="px-3 pt-2 pb-2 border-b border-slate-100">
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">Excel / CSV period</p>
            <div className="flex gap-1.5">
              <select
                value={expMonth} onChange={(e) => setExpMonth(Number(e.target.value))}
                aria-label="Export month"
                className="flex-1 min-w-0 border border-slate-200 rounded px-1.5 h-7 text-[12px] text-slate-600 focus:outline-none focus:border-blue-400"
              >
                {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <select
                value={expYear} onChange={(e) => setExpYear(Number(e.target.value))}
                aria-label="Export year"
                className="w-[76px] flex-shrink-0 border border-slate-200 rounded px-1.5 h-7 text-[12px] text-slate-600 focus:outline-none focus:border-blue-400"
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <button role="menuitem" type="button" disabled={!!busy} onClick={() => downloadFile('xlsx')}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-wait">
            <FileSpreadsheet size={14} className="text-slate-400" />
            {busy === 'xlsx' ? 'Preparing…' : 'Download Excel (.xlsx)'}
          </button>
          <button role="menuitem" type="button" disabled={!!busy} onClick={() => downloadFile('csv')}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-wait">
            <FileText size={14} className="text-slate-400" />
            {busy === 'csv' ? 'Preparing…' : 'Download CSV'}
          </button>
          <div className="border-t border-slate-100 my-1" />
          <button role="menuitem" type="button" disabled={!!busy} onClick={downloadPng}
            title="A snapshot of the chart exactly as shown on screen right now — not affected by the period above"
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-wait">
            <ImageIcon size={14} className="text-slate-400" />
            {busy === 'png' ? 'Preparing…' : 'Download Image (PNG)'}
          </button>
          <p className="px-3 pb-1.5 text-[10px] text-slate-400">PNG captures the chart as shown on screen now.</p>
          {error && <p className="px-3 pt-1.5 text-[11px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
