import React, { useEffect, useRef, useState } from 'react';
import { Upload, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { isFullAccess } from '../utils/roles';

// Choosing the banner on My Space.
//
// Two sources: six banners shipped with the app, or a file from your own
// computer. The shipped ones are SVG drawn for this — a photograph would bring
// a licence question, and an SVG at a few kilobytes cannot fail to load.
//
// The two switches on Organization Policy govern what an EMPLOYEE may do here.
// An administrator always has access and lands on the organization banner —
// with both switches off there would otherwise be no way for anybody to set
// it at all.

// A cover is either one of the banners shipped with the app (preset:name) or a
// file somebody uploaded. Both end up as a background image; only the path
// differs.
export const coverUrl = (cover, presets) => {
  if (!cover) return null;
  if (cover.startsWith('preset:')) return presets?.[cover.slice(7)]?.url || null;
  return cover;
};

export const coverStyle = (cover, presets) => {
  const url = coverUrl(cover, presets);
  if (!url) return { backgroundColor: '#1b2a4a' };
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center 45%',
  };
};

/** Whether this person has any reason to see the cover control at all. */
export function useCanChangeCover() {
  const { user } = useAuth();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (isFullAccess(user)) { setAllowed(true); return () => { cancelled = true; }; }
    api.get('/cover-image')
      .then(r => {
        if (cancelled) return;
        const d = r.data.data || {};
        setAllowed(d.allowSystemOptions === true || d.allowCustomUpload === true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);
  return allowed;
}

export default function CoverImageDialog({ open, onClose, onChanged }) {
  const { user } = useAuth();
  const admin = isFullAccess(user);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  // Which cover is being set: this person's own, or the one everybody without
  // a choice of their own sees. Administrators start on the organization one,
  // because that is what they came here to change.
  const [scope, setScope] = useState(admin ? 'org' : 'self');
  const ownFile = useRef(null);

  const load = () => api.get('/cover-image')
    .then(r => setState(r.data.data))
    .catch(() => setState(null));

  useEffect(() => { if (open) load(); }, [open]);

  if (!open || !state) return null;

  const canChange = state.allowSystemOptions || state.allowCustomUpload;
  const forOrg = admin && scope === 'org';
  const current = forOrg ? state.orgCover : state.own;

  const done = async (message) => {
    await load();
    onChanged?.();
    toast.success(message);
    onClose();
  };

  const choose = async (cover) => {
    setBusy(true);
    try {
      await api.put(forOrg ? '/cover-image/org' : '/cover-image', { cover });
      await done(forOrg ? 'Organization cover updated'
        : (cover ? 'Cover updated' : 'Using the company banner'));
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not update the cover');
    } finally { setBusy(false); }
  };

  const send = async (file, target) => {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append('cover', file);
    try {
      await api.post(`/cover-image/upload${target ? `?target=${target}` : ''}`, form,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      await done('Cover updated');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not upload that image');
    } finally {
      setBusy(false);
      if (ownFile.current) ownFile.current.value = '';
    }
  };

  const Tile = ({ value, style, onPick, label }) => (
    <div className="relative">
      <button
        onClick={onPick} disabled={busy} aria-label={label}
        className={`w-full h-[58px] rounded-lg border-2 transition-all relative overflow-hidden ${
          current === value ? 'border-blue-600' : 'border-transparent hover:border-slate-300'}`}
        style={style}
      >
        {current === value && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="bg-white rounded-full w-5 h-5 flex items-center justify-center shadow">
              <Check size={13} className="text-blue-600" />
            </span>
          </span>
        )}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl w-full max-w-[500px] shadow-xl max-h-[86vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 flex-shrink-0">
          <h3 className="text-[15px] font-semibold text-slate-800">Cover image</h3>
          <button onClick={onClose} aria-label="Close"
            className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Whose banner is being changed. First, because picking an image
              before knowing where it lands is the wrong order. */}
          {admin && (
            <>
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
              <p className="text-[12.5px] text-slate-500 -mt-1">
                {forOrg
                  ? 'The banner everybody sees unless they have chosen their own.'
                  : 'This changes only your own banner.'}
              </p>
            </>
          )}

          {(state.allowSystemOptions || forOrg) && (
            <div>
              <p className="text-[13px] font-medium text-slate-600 mb-2">Choose a banner</p>
              <div className="grid grid-cols-3 gap-2.5">
                {Object.entries(state.presets || {}).map(([key, p]) => (
                  <Tile
                    key={key} value={`preset:${key}`} label={p.label || key}
                    style={{
                      backgroundImage: `url("${p.url}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                    onPick={() => choose(`preset:${key}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {(state.allowCustomUpload || forOrg) && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-[13px] font-medium text-slate-600 mb-2">
                {forOrg ? 'Or upload one for the company banner' : 'Or upload your own'}
              </p>
              <input ref={ownFile} type="file" accept=".jpg,.jpeg,.png,.webp"
                onChange={e => send(e.target.files?.[0], forOrg ? 'org' : null)} className="hidden" />
              <button
                onClick={() => ownFile.current?.click()} disabled={busy}
                className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 px-3.5 py-1.5 rounded-md text-[13.5px] font-medium text-slate-700"
              >
                <Upload size={14} /> {busy ? 'Uploading…' : 'Choose from your computer'}
              </button>
              <p className="text-[12px] text-slate-400 mt-1.5">JPG, PNG or WebP, up to 8MB.</p>
            </div>
          )}

          {!forOrg && state.own && (
            <div className="border-t border-slate-100 pt-4">
              <button onClick={() => choose(null)} disabled={busy}
                className="text-[13px] text-blue-600 hover:underline">
                Use the company banner instead
              </button>
            </div>
          )}

          {admin && !canChange && (
            <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Employees cannot choose their own — both switches are off under Organization
              Policy. You can still set the banner everybody sees.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
