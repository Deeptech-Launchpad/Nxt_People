import React, { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, X, Copy, Check } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';

/**
 * MFA settings panel — drops onto the Profile "Security" section.
 * Handles enrolment (QR scan → verify code → display backup codes),
 * disabling, and regenerating backup codes.
 *
 * Props:
 *   mfaEnabled  — current state from the profile API
 *   onChange()  — called after any successful enable/disable so the parent
 *                 can reload the profile and refresh nav badges.
 */
export default function MfaSettingsCard({ mfaEnabled, onChange }) {
  const [setupOpen, setSetupOpen]   = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [setupData, setSetupData]   = useState(null); // { secret, otpauth, qrDataUrl }
  const [code, setCode]             = useState('');
  const [busy, setBusy]             = useState(false);
  const [backupCodes, setBackupCodes] = useState(null); // shown once after verify

  /* ── Enable flow ────────────────────────────────────────────────── */
  const startSetup = async () => {
    setBusy(true);
    try {
      const r = await api.post('/mfa/setup');
      setSetupData(r.data);
      setSetupOpen(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to start setup');
    } finally { setBusy(false); }
  };

  const verifySetup = async (e) => {
    e.preventDefault();
    if (!code.trim()) return toast.error('Enter the 6-digit code');
    setBusy(true);
    try {
      const r = await api.post('/mfa/verify-setup', { code: code.trim() });
      setBackupCodes(r.data.backupCodes);
      setSetupData(null);
      setCode('');
      onChange?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid code');
    } finally { setBusy(false); }
  };

  const closeSetup = () => {
    setSetupOpen(false);
    setSetupData(null);
    setBackupCodes(null);
    setCode('');
  };

  /* ── Disable flow ───────────────────────────────────────────────── */
  const submitDisable = async (e) => {
    e.preventDefault();
    if (!code.trim()) return toast.error('Enter a valid code or backup code');
    setBusy(true);
    try {
      const payload = /^[0-9]{6}$/.test(code.trim())
        ? { code: code.trim() }
        : { backupCode: code.trim() };
      await api.post('/mfa/disable', payload);
      toast.success('Two-factor authentication disabled');
      setDisableOpen(false);
      setCode('');
      onChange?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to disable');
    } finally { setBusy(false); }
  };

  /* ── ESC closes any open modal ─────────────────────────────────── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { closeSetup(); setDisableOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
        mfaEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
      }`}>
        {mfaEnabled ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
      </div>
      <div className="flex-1">
        <p className="text-[15px] font-semibold text-slate-800">
          Two-Factor Authentication (TOTP)
        </p>
        <p className="text-[14px] text-slate-500 mt-0.5">
          {mfaEnabled
            ? 'A 6-digit code from your authenticator app is required at every login.'
            : 'Add an extra step at login using Google Authenticator, Authy, or 1Password.'}
        </p>
        <div className="mt-3 flex gap-2">
          {mfaEnabled ? (
            <button
              onClick={() => setDisableOpen(true)}
              className="text-[14px] font-semibold text-red-600 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-md transition-colors"
            >
              Disable two-factor
            </button>
          ) : (
            <button
              onClick={startSetup}
              disabled={busy}
              className="text-[14px] font-semibold text-white bg-[#1a73e8] hover:bg-[#1557B0] px-3 py-1.5 rounded-md transition-colors disabled:opacity-60"
            >
              Enable two-factor
            </button>
          )}
        </div>
      </div>

      {/* ── Setup modal — QR + code entry ────────────────────────── */}
      {setupOpen && setupData && (
        <Modal onClose={closeSetup} title="Set up two-factor authentication">
          <ol className="text-[15px] text-slate-700 space-y-3 list-decimal pl-5">
            <li>Install an authenticator app (Google Authenticator, Authy, 1Password, etc.) on your phone.</li>
            <li>Scan this QR code with the app:
              <div className="mt-2 p-3 bg-white border border-slate-200 rounded-lg inline-block">
                <img src={setupData.qrDataUrl} alt="MFA QR code" className="w-40 h-40" />
              </div>
              <p className="text-[13px] text-slate-500 mt-2">
                Can't scan? Enter this secret manually:
                <code className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded font-mono text-[13px] tracking-wider break-all">
                  {setupData.secret}
                </code>
              </p>
            </li>
            <li>Enter the 6-digit code shown in your authenticator app to confirm.</li>
          </ol>
          <form onSubmit={verifySetup} className="mt-4 flex gap-2">
            <input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-[16px] font-mono tracking-widest text-center focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="bg-[#1a73e8] hover:bg-[#1557B0] text-white px-4 py-2 rounded-md text-[15px] font-semibold disabled:opacity-50"
            >
              Verify & enable
            </button>
          </form>
        </Modal>
      )}

      {/* ── Backup codes display — shown ONCE after a successful enable ── */}
      {backupCodes && (
        <Modal onClose={closeSetup} title="Save your backup codes">
          <p className="text-[14px] text-slate-600 mb-3">
            Store these somewhere safe. Each code works <strong>once</strong> if you lose access to
            your authenticator app. They will not be shown again.
          </p>
          <BackupCodeList codes={backupCodes} />
          <button
            onClick={closeSetup}
            className="mt-4 w-full bg-[#1a73e8] hover:bg-[#1557B0] text-white py-2 rounded-md text-[15px] font-semibold"
          >
            I've saved them
          </button>
        </Modal>
      )}

      {/* ── Disable modal ─────────────────────────────────────── */}
      {disableOpen && (
        <Modal onClose={() => setDisableOpen(false)} title="Disable two-factor authentication">
          <p className="text-[14px] text-slate-600 mb-3">
            Enter your current 6-digit code or one of your backup codes to confirm.
          </p>
          <form onSubmit={submitDisable} className="space-y-3">
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456 or ABCD-EFGH"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-[16px] font-mono focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDisableOpen(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-md text-[15px] font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-md text-[15px] font-semibold disabled:opacity-50"
              >
                Disable
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ── Small reusable modal shell ────────────────────────────────────── */
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-[14.5px] font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="w-7 h-7 rounded hover:bg-slate-100 flex items-center justify-center text-slate-500">
            <X size={15} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ── Backup-code grid + copy-all + download ─────────────────────────── */
function BackupCodeList({ codes }) {
  const [copied, setCopied] = useState(false);
  const copyAll = async () => {
    await navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const download = () => {
    const blob = new Blob([codes.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'nxt-people-mfa-backup-codes.txt'; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5 p-3 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[14px]">
        {codes.map((c) => <span key={c} className="text-slate-700">{c}</span>)}
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={copyAll}
          className="flex-1 inline-flex items-center justify-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 py-1.5 rounded-md text-[14px] font-semibold"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy all'}
        </button>
        <button
          onClick={download}
          className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-700 py-1.5 rounded-md text-[14px] font-semibold"
        >
          Download .txt
        </button>
      </div>
    </>
  );
}
