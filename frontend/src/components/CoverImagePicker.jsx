import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Upload, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { isFullAccess } from '../utils/roles';

// Choosing the banner on My Space.
//
// The two switches on Organization Policy decide what an EMPLOYEE sees here:
// presets, uploads, both, or nothing at all. With neither allowed the button
// does not render for them — a control that always refuses is worse than no
// control.
//
// An administrator always sees it, and defaults to the organization cover.
// Those switches govern what employees may do; with both off there was
// otherwise no way for anybody to set the banner, and it stayed on the default
// gradient permanently.
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
  const { user } = useAuth();
  const admin = isFullAccess(user);
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Which cover is being set: this person's own, or the one everybody without
  // a choice of their own sees. Administrators start on the organization one,
  // because that is what they came here to change.
  const [scope, setScope] = useState('org');
  const fileRef = useRef(null);

  const load = () => api.get('/cover-image')
    .then(r => setState(r.data.data))
    .catch(() => setState(null));

  useEffect(() => { load(); }, []);

  if (!state) return null;
  const canChange = state.allowSystemOptions || state.allowCustomUpload;
  // An administrator always gets the button. Those two switches govern what
  // EMPLOYEES may do; with both off there was previously no way for anybody to
  // set the organization banner, so it stayed on the default gradient forever.
  if (!canChange && !admin) return null;
  const forOrg = admin && scope === 'org';

  const choose = async (cover) => {
    setBusy(true);
    try {
      await api.put(forOrg ? '/cover-image/org' : '/cover-image', { cover });
      await load();
      onChanged?.();
      toast.success(forOrg
        ? 'Organization cover updated'
        : (cover ? 'Cover updated' : 'Using the organization cover'));
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
      await api.post(`/cover-image/upload${forOrg ? '?target=org' : ''}`, form,
        { headers: { 'Content-Type': 'multipart/form-data' } });
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
              {/* Which cover is being changed. Only administrators see this,
                  and it comes first because picking a colour before knowing
                  whose banner it lands on is the wrong order. */}
              {admin && (
                <div className="inline-flex rounded-md bg-slate-100 p-0.5">
                  {[['org', 'Everyone'], ['self', 'Just me']].map(([v, l]) => (
                    <label key={v}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded text-[13px] cursor-pointer ${
                        scope === v ? 'bg-white text-slate-800 shadow-sm font-medium' : 'text-slate-500'}`}>
                      <input type="radio" name="coverScope" className="w-3.5 h-3.5 accent-blue-600"
                        checked={scope === v} onChange={() => setScope(v)} />
                      {l}
                    </label>
                  ))}
                </div>
              )}

              {admin && (
                <p className="text-[12.5px] text-slate-500 -mt-1">
                  {forOrg
                    ? 'This is the banner everybody sees unless they have chosen their own.'
                    : 'This changes only your own banner.'}
                </p>
              )}

              {(state.allowSystemOptions || forOrg) && (
                <div>
                  <p className="text-[13px] font-medium text-slate-600 mb-2">Choose one</p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {Object.keys(state.presets || {}).map(key => {
                      const value = `preset:${key}`;
                      const active = (forOrg ? state.orgCover : state.own) === value;
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

              {(state.allowCustomUpload || forOrg) && (
                <div className={(state.allowSystemOptions || forOrg) ? 'border-t border-slate-100 pt-4' : ''}>
                  <p className="text-[13px] font-medium text-slate-600 mb-2">
                    {forOrg ? 'Or upload the company banner' : 'Or upload your own'}
                  </p>
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

              {!forOrg && state.own && (
                <div className="border-t border-slate-100 pt-4">
                  <button onClick={() => choose(null)} disabled={busy}
                    className="text-[13px] text-blue-600 hover:underline">
                    Use the organization cover instead
                  </button>
                </div>
              )}

              {admin && !canChange && (
                <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Employees cannot choose their own cover — both switches are off under
                  Organization Policy. You can still set the one everybody sees.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
