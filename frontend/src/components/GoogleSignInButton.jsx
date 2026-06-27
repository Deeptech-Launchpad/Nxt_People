import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

/* ── Google Sign-In (company accounts only) ───────────────────────────────
 *  Renders the official Google Identity Services button. On success it hands
 *  the returned ID token to the backend (`/auth/google`), which verifies it,
 *  enforces the company domain, matches the employee, and starts a session.
 *
 *  This is an ADDITIVE login option — if VITE_GOOGLE_CLIENT_ID is not set the
 *  component renders nothing, so the existing email/password flow is unchanged.
 *
 *  Props:
 *    onMfaRequired(mfaTicket) — called when the matched account has MFA enabled,
 *                               so the page can switch to its TOTP step.
 * ───────────────────────────────────────────────────────────────────────── */

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
// Optional UX hint to pre-filter the Google account chooser to the company
// domain. Real enforcement always happens server-side.
const HOSTED_DOMAIN = import.meta.env.VITE_GOOGLE_HOSTED_DOMAIN || undefined;

// Best-effort decode of the email claim from a Google ID token, purely for
// display on the MFA step. The backend is the source of truth for verification.
function emailFromCredential(credential) {
  try {
    const payload = credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(payload)))).email || '';
  } catch { return ''; }
}

// Load the GSI script once and resolve when window.google.accounts is ready.
let gsiPromise = null;
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Sign-In')));
      return;
    }
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Sign-In'));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

export default function GoogleSignInButton({ onMfaRequired }) {
  const btnRef = useRef(null);
  const [ready, setReady] = useState(false);
  const { loginGoogle } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!CLIENT_ID) return; // Not configured — render nothing.
    let cancelled = false;

    const handleCredential = async (response) => {
      try {
        const result = await loginGoogle(response.credential);
        if (result?.mfaRequired) {
          onMfaRequired?.(result.mfaTicket, emailFromCredential(response.credential));
          return;
        }
        toast.success('Signed in with Google');
        navigate('/');
      } catch (err) {
        toast.error(err.response?.data?.message || err.message || 'Google sign-in failed');
      }
    };

    loadGsi()
      .then(() => {
        if (cancelled || !btnRef.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: handleCredential,
          hd: HOSTED_DOMAIN,
          ux_mode: 'popup',
          auto_select: false,
        });
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: 'outline',
          size: 'large',
          width: 360,
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'center',
        });
        setReady(true);
      })
      .catch(() => { /* leave hidden; password login still works */ });

    return () => { cancelled = true; };
  }, [loginGoogle, navigate, onMfaRequired]);

  if (!CLIENT_ID) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-sm text-slate-400 font-medium">or</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
      {/* Google renders its official button into this container. */}
      <div ref={btnRef} className="flex justify-center min-h-[44px]" />
      {!ready && (
        <p className="text-center text-sm text-slate-400 mt-2">Loading Google Sign-In…</p>
      )}
    </div>
  );
}
