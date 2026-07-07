import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';
import GoogleSignInButton from '../components/GoogleSignInButton';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Check, Clock, XCircle, CheckCircle2, Mail } from 'lucide-react';
import './Login.css';

/* ── Branding config (left panel) ─────────────────────────────────────────
   Pure presentation — does not affect any auth logic. */
const APP_NAME  = 'Nxt People';
const APP_SHORT = 'NP';
const SUPPORT_EMAIL = 'it@altiusnxt.com';
const FEATURES = [
  'Attendance & Time Tracking',
  'Leave & Holiday Management',
  'HR Reports & Analytics',
];
const SUITE = [
  { name: 'HR',         active: true },
  { name: 'LMS',        url: 'https://lms.altiusnxt.tech/login' },
  { name: 'Billing',    url: 'http://72.61.245.208:5000/login' },
  { name: 'Helpdesk',   url: 'https://tickets.altiusnxt.tech/login' },
  { name: 'Assessment', url: 'https://assess.altiusnxt.tech' },
  { name: 'Reports',    url: 'https://ur.altiusnxt.tech' },
];

const Spinner = ({ dark }) => <span className={`spinner${dark ? ' spinner-dark' : ''}`} />;

/* ── Left panel ────────────────────────────────────────────────────────── */
const LeftPanel = () => (
  <div className="left">
    <div className="geo" aria-hidden="true">
      <div className="geo-1" /><div className="geo-2" /><div className="geo-3" />
    </div>
    <div className="logo-wrap"><img src="/logo.png" alt="AltiusNxt Technologies" /></div>
    <div className="left-body">
      <div className="left-divider" />
      <p className="access-label">Secure Workspace Access</p>
      <h2 className="app-name">{APP_NAME}</h2>
      <div className="red-rule" />
      <ul className="feature-list">
        {FEATURES.map(f => (
          <li className="feature-item" key={f}>
            <span className="feat-icon"><Check size={14} strokeWidth={2.5} /></span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
    <div className="left-bottom">
      <div className="bottom-divider" />
      <p className="suite-label">Part of AltiusNxt Suite</p>
      <div className="suite-chips">
        {SUITE.map(s =>
          s.active
            ? <span className="suite-chip active" key={s.name}>{s.name}</span>
            : s.url
              ? <a className="suite-chip" href={s.url} key={s.name}>{s.name}</a>
              : <span className="suite-chip" key={s.name}>{s.name}</span>
        )}
      </div>
      <p className="left-foot">© {new Date().getFullYear()} AltiusNxt Technologies Pvt. Ltd.</p>
    </div>
  </div>
);

/* ── STEP 1 — Email ────────────────────────────────────────────────────── */
function StepEmail({ onNext, onGoogleMfaRequired }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { checkEmail } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const val = email.trim();
    if (!val || !val.includes('@')) { setError('Please enter a valid work email.'); return; }
    setLoading(true);
    try {
      const result = await checkEmail(val);
      onNext(val, result);
    } catch (err) {
      // Distinguish a server/connection failure (no response) from a real
      // verification error, so a transient backend hiccup doesn't look like a
      // bad email.
      setError(!err.response
        ? 'Cannot reach the server. Please check your connection and try again.'
        : (err.response?.data?.message || 'Could not verify email. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 className="step-title">Sign in</h1>
      <p className="step-sub">Enter your work email to get started.</p>

      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="inp-email">Work Email</label>
          <input
            type="email" id="inp-email" value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@altiusnxt.com" autoComplete="email" autoFocus
          />
        </div>
        {error && <p className="msg-error">{error}</p>}
        <button type="submit" className="submit-btn" disabled={loading}>
          {loading ? <Spinner /> : <>Continue <ArrowRight size={16} /></>}
        </button>
      </form>

      {/* Google Sign-In — GIS token flow (unchanged). Renders nothing when
          VITE_GOOGLE_CLIENT_ID is not configured. */}
      <GoogleSignInButton onMfaRequired={onGoogleMfaRequired} />

      {/* Demo shortcuts — dev/test only (stripped from production bundles). */}
      {!import.meta.env.PROD && (
        <div className="demo-wrap">
          <p className="demo-label">Quick Access (Demo)</p>
          <div className="demo-grid">
            {[
              { l: 'Admin',     e: 'admin@nxtpeople.com' },
              { l: 'Team Lead', e: 'sarah@nxtpeople.com' },
              { l: 'Employee',  e: 'michael@nxtpeople.com' },
            ].map(({ l, e }) => (
              <button key={l} type="button" className="demo-btn" onClick={() => setEmail(e)}>{l}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ── STEP 2 — Password ─────────────────────────────────────────────────── */
function StepPassword({ email, firstName, onBack, onForgot, onMfaRequired }) {
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!password) { setError('Please enter your password.'); return; }
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result?.mfaRequired) { onMfaRequired?.(result.mfaTicket); return; }
      toast.success('Welcome back!');
      navigate('/');
    } catch (err) {
      setError(!err.response
        ? 'Cannot reach the server. Please check your connection and try again.'
        : (err.response?.data?.message || 'Incorrect password. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button type="button" className="email-back" onClick={onBack}>
        <ArrowLeft size={14} />
        <span className="email-back-addr">{email}</span>
      </button>

      <div className="welcome-block">
        <h1 className="welcome-title">Welcome back</h1>
        <p className="welcome-sub">
          Hi{firstName ? ` ${firstName}` : ''}, enter your password to continue.
        </p>
      </div>

      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <div className="label-row">
            <label htmlFor="inp-password">Password</label>
            <button type="button" className="forgot-btn" onClick={onForgot}>Forgot password?</button>
          </div>
          <div className="pw-wrap">
            <input
              type={showPass ? 'text' : 'password'} id="inp-password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete="current-password" autoFocus
            />
            <button type="button" className="pw-toggle" onClick={() => setShowPass(v => !v)}
              aria-label={showPass ? 'Hide password' : 'Show password'}>
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {error && <p className="msg-error">{error}</p>}
        <button type="submit" className="submit-btn" disabled={loading}>
          {loading ? <Spinner /> : <>Sign In <ArrowRight size={16} /></>}
        </button>
      </form>
    </>
  );
}

/* ── STEP — Pending approval ───────────────────────────────────────────── */
function StepPending({ email, firstName, onBack }) {
  return (
    <>
      <button type="button" className="email-back" onClick={onBack}>
        <ArrowLeft size={14} /> Use a different email
      </button>
      <div className="status-icon" style={{ background: 'rgba(245,158,11,0.1)' }}>
        <Clock size={26} color="#d97706" />
      </div>
      <h1 className="step-title">Awaiting Approval</h1>
      <p className="step-sub" style={{ marginBottom: 20 }}>
        Hi{firstName ? ` ${firstName}` : ''}, your registration request is being reviewed by an administrator.
      </p>
      <div className="info-card warn">
        <p className="info-card-title">What happens next?</p>
        <ul className="info-list">
          <li>An admin will review your request</li>
          <li>You'll be notified once approved</li>
          <li>Come back here to confirm and access the app</li>
        </ul>
      </div>
      <p className="step-sub" style={{ marginTop: 16, marginBottom: 0 }}>{email}</p>
    </>
  );
}

/* ── STEP — Rejected ───────────────────────────────────────────────────── */
function StepRejected({ email, onBack }) {
  return (
    <>
      <button type="button" className="email-back" onClick={onBack}>
        <ArrowLeft size={14} /> Back
      </button>
      <div className="status-icon" style={{ background: 'rgba(230,51,41,0.1)' }}>
        <XCircle size={26} color="#e63329" />
      </div>
      <h1 className="step-title">Request Not Approved</h1>
      <p className="step-sub">
        Your registration request for <strong>{email}</strong> was not approved. Please contact your HR administrator.
      </p>
    </>
  );
}

/* ── STEP — Accept terms ───────────────────────────────────────────────── */
function StepAccept({ email, firstName, setupToken, onBack }) {
  const [loading, setLoading] = useState(false);
  const { acceptTerms } = useAuth();
  const navigate = useNavigate();

  const handleAccept = async () => {
    setLoading(true);
    try {
      await acceptTerms(email, setupToken);
      toast.success(`Welcome, ${firstName || ''}!`);
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not complete setup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button type="button" className="email-back" onClick={onBack}>
        <ArrowLeft size={14} /> Back
      </button>
      <div className="status-icon" style={{ background: 'rgba(230,51,41,0.1)' }}>
        <CheckCircle2 size={26} color="#e63329" />
      </div>
      <h1 className="step-title">You're approved!</h1>
      <p className="step-sub" style={{ marginBottom: 16 }}>
        Hi{firstName ? ` ${firstName}` : ''}, your account has been approved. Please confirm to access the platform.
      </p>
      <div className="terms-box">
        <p style={{ fontWeight: 600, color: '#334155', marginBottom: 6 }}>Platform Usage Agreement</p>
        By confirming access, you agree to use Nxt People responsibly and in accordance with your organization's
        HR policies. All activity on this platform may be monitored and is subject to company guidelines. Your
        personal data will be processed as described in the company privacy policy.
      </div>
      <button type="button" className="submit-btn" onClick={handleAccept} disabled={loading}>
        {loading ? <Spinner /> : <><CheckCircle2 size={16} /> I Accept — Continue</>}
      </button>
    </>
  );
}

/* ── STEP — Forgot password ────────────────────────────────────────────── */
function StepForgotPassword({ email, onBack }) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleForgot = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <>
        <button type="button" className="email-back" onClick={onBack}>
          <ArrowLeft size={14} /> Back to sign in
        </button>
        <div className="status-icon" style={{ background: 'rgba(5,150,105,0.1)' }}>
          <Mail size={26} color="#059669" />
        </div>
        <h1 className="step-title">Check your inbox</h1>
        <p className="step-sub">
          If an account exists for <strong>{email}</strong>, we've sent a password-reset link. It expires in
          10 minutes — open it on this device and you'll land on a "set new password" page.
        </p>
        <p className="step-sub" style={{ marginBottom: 0 }}>
          Didn't get it? Check spam, or{' '}
          <button type="button" className="forgot-btn" onClick={() => setSent(false)}>try again</button>.
        </p>
      </>
    );
  }

  return (
    <>
      <button type="button" className="email-back" onClick={onBack}>
        <ArrowLeft size={14} /> Back to sign in
      </button>
      <h1 className="step-title">Reset password</h1>
      <p className="step-sub">We'll email a reset link to <strong>{email}</strong>.</p>
      <form className="form" onSubmit={handleForgot} noValidate>
        <button type="submit" className="submit-btn" disabled={loading}>
          {loading ? <Spinner /> : <>Send Reset Email <ArrowRight size={16} /></>}
        </button>
      </form>
    </>
  );
}

/* ── STEP — Reset password ─────────────────────────────────────────────── */
function StepResetPassword({ token, onBack }) {
  const [newPassword, setNewPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleReset = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put(`/auth/reset-password/${token}`, { newPassword });
      toast.success('Password reset successfully — please log in with your new password.');
      // Invalidate any current session so the new password takes effect immediately.
      localStorage.removeItem('nxt_token');
      localStorage.removeItem('nxt_refresh_token');
      delete api.defaults.headers.common.Authorization;
      setTimeout(() => { window.location.assign('/login'); }, 800);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button type="button" className="email-back" onClick={onBack}>
        <ArrowLeft size={14} /> Back
      </button>
      <h1 className="step-title">New password</h1>
      <p className="step-sub">Enter your new password.</p>
      <form className="form" onSubmit={handleReset} noValidate>
        <div className="field">
          <label htmlFor="inp-newpw">New Password</label>
          <div className="pw-wrap">
            <input
              type={showPass ? 'text' : 'password'} id="inp-newpw" value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="••••••••" minLength={6} required
            />
            <button type="button" className="pw-toggle" onClick={() => setShowPass(v => !v)}
              aria-label={showPass ? 'Hide password' : 'Show password'}>
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <button type="submit" className="submit-btn" disabled={loading}>
          {loading ? <Spinner /> : <><CheckCircle2 size={16} /> Save Password</>}
        </button>
      </form>
    </>
  );
}

/* ── STEP — MFA challenge ──────────────────────────────────────────────── */
function StepMfa({ email, mfaTicket, onBack }) {
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [loading, setLoading] = useState(false);
  const { loginMfa } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    try {
      const payload = useBackup
        ? { mfaTicket, backupCode: code.trim() }
        : { mfaTicket, code: code.trim() };
      await loginMfa(payload);
      toast.success('Welcome back!');
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button type="button" className="email-back" onClick={onBack}>
        <ArrowLeft size={14} /> <span className="email-back-addr">{email}</span>
      </button>
      <h1 className="step-title">Two-factor authentication</h1>
      <p className="step-sub">
        {useBackup
          ? 'Enter one of your saved backup codes (e.g. ABCD-EFGH).'
          : 'Enter the 6-digit code from your authenticator app.'}
      </p>
      <form className="form" onSubmit={submit} noValidate>
        <input
          autoFocus
          className="mfa-input"
          value={code}
          onChange={(e) => setCode(useBackup ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))}
          inputMode={useBackup ? 'text' : 'numeric'}
          maxLength={useBackup ? 9 : 6}
          placeholder={useBackup ? 'ABCD-EFGH' : '123456'}
        />
        <button type="submit" className="submit-btn" disabled={loading || !code.trim()}>
          {loading ? <Spinner /> : 'Verify & continue'}
        </button>
      </form>
      <button type="button" className="link-btn" onClick={() => { setUseBackup(v => !v); setCode(''); }}>
        {useBackup ? 'Use authenticator code instead' : 'Use a backup code instead'}
      </button>
    </>
  );
}

/* ── Main Login component ──────────────────────────────────────────────── */
export default function Login() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const setupToken = searchParams.get('setupToken');
  const [step, setStep] = useState(token ? 'reset' : 'email'); // email | pending | rejected | accept | password | mfa | forgot | reset
  const [emailData, setEmailData] = useState({ email: '', status: null, hasAccepted: false, firstName: '' });
  const [resetToken, setResetToken] = useState(token || '');
  const [mfaTicket, setMfaTicket] = useState('');

  useEffect(() => {
    if (token) { setStep('reset'); setResetToken(token); }
  }, [token]);

  const handleEmailNext = (email, result) => {
    setEmailData({ email, ...result });
    const { status, hasAccepted } = result;
    if (status === 'new') {
      toast.error('Account not found. Please contact HR for an onboarding link.');
      setStep('email');
    }
    else if (status === 'pending') setStep('pending');
    else if (status === 'rejected') setStep('rejected');
    else if (status === 'approved' && !hasAccepted) setStep('accept');
    else setStep('password'); // active
  };

  const reset = () => { setStep('email'); setEmailData({ email: '', status: null, hasAccepted: false, firstName: '' }); setResetToken(''); };

  // Google sign-in landed on an MFA-enabled account → jump to the TOTP step.
  const handleGoogleMfaRequired = (ticket, googleEmail) => {
    if (googleEmail) setEmailData(d => ({ ...d, email: googleEmail }));
    setMfaTicket(ticket);
    setStep('mfa');
  };

  return (
    <div className="nxt-login">
      <div className="page">
        <LeftPanel />
        <div className="right">
          <div className="right-content">
            <div className="app-badge"><span className="app-badge-short">{APP_SHORT}</span></div>

            {step === 'email' && <StepEmail onNext={handleEmailNext} onGoogleMfaRequired={handleGoogleMfaRequired} />}
            {step === 'pending' && <StepPending email={emailData.email} firstName={emailData.firstName} onBack={reset} />}
            {step === 'rejected' && <StepRejected email={emailData.email} onBack={reset} />}
            {step === 'accept' && <StepAccept email={emailData.email} firstName={emailData.firstName} setupToken={setupToken} onBack={reset} />}
            {step === 'password' && <StepPassword
              email={emailData.email}
              firstName={emailData.firstName}
              onBack={reset}
              onForgot={() => setStep('forgot')}
              onMfaRequired={(ticket) => { setMfaTicket(ticket); setStep('mfa'); }}
            />}
            {step === 'mfa' && <StepMfa email={emailData.email} mfaTicket={mfaTicket} onBack={() => setStep('password')} />}
            {step === 'forgot' && <StepForgotPassword email={emailData.email} onBack={() => setStep('password')} />}
            {step === 'reset' && <StepResetPassword token={resetToken} onBack={() => setStep('forgot')} />}

            <div className="right-foot">Need help? <a href={`mailto:${SUPPORT_EMAIL}`}>Contact IT Support</a></div>
          </div>
        </div>
      </div>
    </div>
  );
}
