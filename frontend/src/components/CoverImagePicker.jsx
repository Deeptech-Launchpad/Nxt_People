import React, { useEffect, useRef, useState } from 'react';
import { Upload, X, Check, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { isFullAccess } from '../utils/roles';

// Choosing the banner on My Space.
//
// Three sources, in the order somebody would look for them: banners the
// organization uploaded for everybody, a handful of built-in gradients, and
// your own file.
//
// The library exists instead of stock photographs shipped with the code, which
// would mean binary assets in the repository and a licence question nobody
// asked for. A company's own images are the better answer anyway, and an
// administrator uploads them once.
//
// The two switches on Organization Policy govern what an EMPLOYEE may do here.
// An administrator always has access and lands on the organization cover —
// with both switches off there would otherwise be no way for anybody to set
// the banner at all.

export const coverStyle = (cover, presets) => {
  if (!cover) return {};
  if (cover.startsWith('preset:')) {
    return {
      backgroundImage: presets?.[cover.slice(7)]
        || presets?.dusk
        || 'linear-gradient(160deg,#16283f,#7f9bc4)',
    };
  }
  return { backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: 'center 35%' };
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
  const libFile = useRef(null);

  const load = () => api.get('/cover-image')
    .then(r => setState(r.data.data))
    .catch(() => setState(null));

  useEffect(() => { if (open) load(); }, [open]);

  if (!open || !state) return null;

  const canChange = state.allowSystemOptions || state.allowCustomUpload;
  const forOrg = admin && scope === 'org';
  const current = forOrg ? state.orgCover : state.own;
  const library = state.library || [];

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
      // A library upload stays on the dialog: adding several in a row is the
      // normal case, and closing after each one would be tedious.
      if (target === 'library') { await load(); toast.success('Added to the library'); }
      else await done('Cover updated');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not upload that image');
    } finally {
      setBusy(false);
      if (ownFile.current) ownFile.current.value = '';
      if (libFile.current) libFile.current.value = '';
    }
  };

  const removeFromLibrary = async (cover) => {
    if (!window.confirm('Remove this banner from the library? Anybody already using it keeps it.')) return;
    setBusy(true);
    try {
      await api.delete('/cover-image/library', { data: { cover } });
      await load();
      toast.success('Removed from the library');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not remove it');
    } finally { setBusy(false); }
  };

  const Tile = ({ value, style, onPick, onRemove, label }) => (
    <div className="relative group">
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
      {onRemove && (
        <button
          onClick={onRemove} disabled={busy}
          aria-label="Remove from library"
          className="absolute -top-1.5 -right-1.5 bg-white border border-slate-200 rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
        >
          <Trash2 size={11} className="text-rose-500" />
        </button>
      )}
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

          {/* The organization's own banners. */}
          {(library.length > 0 || admin) && (
            <div>
              <p className="text-[13px] font-medium text-slate-600 mb-2">
                {library.length ? 'Company banners' : 'Company banners — none yet'}
              </p>
              {library.length > 0 && (
                <div className="grid grid-cols-4 gap-2.5">
                  {library.map(url => (
                    <Tile
                      key={url} value={url} label="Company banner"
                      style={{ backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                      onPick={() => choose(url)}
                      onRemove={admin ? () => removeFromLibrary(url) : null}
                    />
                  ))}
                </div>
              )}
              {admin && (
                <>
                  <input ref={libFile} type="file" accept=".jpg,.jpeg,.png,.webp"
                    onChange={e => send(e.target.files?.[0], 'library')} className="hidden" />
                  <button
                    onClick={() => libFile.current?.click()} disabled={busy}
                    className="mt-2.5 flex items-center gap-1.5 border border-dashed border-slate-300 hover:border-blue-400 hover:text-blue-600 px-3.5 py-1.5 rounded-md text-[13px] font-medium text-slate-600"
                  >
                    <Upload size={13} /> Add a banner everyone can pick
                  </button>
                  <p className="text-[12px] text-slate-400 mt-1.5">
                    Uploaded once and offered to everybody. Hover a banner to remove it.
                  </p>
                </>
              )}
            </div>
          )}

          {(state.allowSystemOptions || forOrg) && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-[13px] font-medium text-slate-600 mb-2">Or a built-in one</p>
              <div className="grid grid-cols-4 gap-2.5">
                {Object.keys(state.presets || {}).map(key => (
                  <Tile
                    key={key} value={`preset:${key}`} label={`Cover ${key}`}
                    style={{ backgroundImage: state.presets[key] }}
                    onPick={() => choose(`preset:${key}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {(state.allowCustomUpload || forOrg) && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-[13px] font-medium text-slate-600 mb-2">
                {forOrg ? 'Or upload one just for the banner' : 'Or upload your own'}
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
