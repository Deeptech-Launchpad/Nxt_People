import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Upload, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

// Choosing the banner on My Space.
//
// The two switches on Organization Policy decide what appears here: presets,
// uploads, both, or nothing at all. When neither is allowed the button does not
// render — a control that always refuses is worse than no control.
//
// Presets are gradients rather than photographs, so nothing is fetched from
// anywhere and a cover cannot fail to load.

export const coverStyle = (cover, presets) => {
  if (!cover) return {};
  if (cover.startsWith('preset:')) {
    return { backgroundImage: presets?.[cover.slice(7)] || presets?.dusk || 'linear-gradient(135deg,#1e3a5f,#8fa3c4)' };
  }
  return { backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: 'center 35%' };
};

export default function CoverImagePicker({ onChanged }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => api.get('/cover-image')
    .then(r => setState(r.data.data))
    .catch(() => setState(null));

  useEffect(() => { load(); }, []);

  if (!state) return null;
  const canChange = state.allowSystemOptions || state.allowCustomUpload;
  if (!canChange) return null;

  const choose = async (cover) => {
    setBusy(true);
    try {
      await api.put('/cover-image', { cover });
      await load();
      onChanged?.();
      toast.success(cover ? 'Cover updated' : 'Using the organization cover');
      setOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not update the cover');
    } finally { setBusy(false); }
  };

  const send = async (file) => {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append('cover', file);
    try {
      await api.post('/cover-image/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
      onChanged?.();
      toast.success('Cover updated');
      setOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not upload that image');
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Change cover image"
        className="bg-white/90 backdrop-blur-sm hover:bg-white text-slate-700 text-[13.5px] font-semibold px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all shadow-sm border border-white/80"
      >
        <ImageIcon size={13} /> Cover
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="bg-white rounded-xl w-full max-w-[470px] shadow-xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-[15px] font-semibold text-slate-800">Cover image</h3>
              <button onClick={() => setOpen(false)} aria-label="Close"
                className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {state.allowSystemOptions && (
                <div>
                  <p className="text-[13px] font-medium text-slate-600 mb-2">Choose one</p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {Object.keys(state.presets || {}).map(key => {
                      const value = `preset:${key}`;
                      const active = state.own === value;
                      return (
                        <button
                          key={key} onClick={() => choose(value)} disabled={busy}
                          aria-label={`Cover ${key}`}
                          className={`h-[52px] rounded-lg border-2 relative transition-all ${
                            active ? 'border-blue-600' : 'border-transparent hover:border-slate-300'}`}
                          style={{ backgroundImage: state.presets[key] }}
                        >
                          {active && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <Check size={18} className="text-white drop-shadow" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {state.allowCustomUpload && (
                <div className={state.allowSystemOptions ? 'border-t border-slate-100 pt-4' : ''}>
                  <p className="text-[13px] font-medium text-slate-600 mb-2">Or upload your own</p>
                  <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp"
                    onChange={e => send(e.target.files?.[0])} className="hidden" />
                  <button
                    onClick={() => fileRef.current?.click()} disabled={busy}
                    className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 px-3.5 py-1.5 rounded-md text-[13.5px] font-medium text-slate-700"
                  >
                    <Upload size={14} /> {busy ? 'Uploading…' : 'Choose an image'}
                  </button>
                  <p className="text-[12px] text-slate-400 mt-1.5">JPG, PNG or WebP, up to 8MB.</p>
                </div>
              )}

              {state.own && (
                <div className="border-t border-slate-100 pt-4">
                  <button onClick={() => choose(null)} disabled={busy}
                    className="text-[13px] text-blue-600 hover:underline">
                    Use the organization cover instead
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
