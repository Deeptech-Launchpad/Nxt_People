import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft,
  User, Phone, Briefcase, Building2, Layers, BadgeCheck,
  Clock, XCircle, CheckCircle2, ChevronDown
} from 'lucide-react';

// ─── Reusable Input ────────────────────────────────────────────────────────────
const Field = ({ label, icon: Icon, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">
      {label}{required && <span className="text-brand-600 ml-1">*</span>}
    </label>
    <div className="relative">
      {Icon && <Icon size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />}
      {children}
    </div>
  </div>
);

const inputCls = (hasIcon = true) =>
  `w-full bg-white border border-slate-200 text-slate-800 ${hasIcon ? 'pl-10' : 'pl-4'} pr-4 py-2.5 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder-slate-400 transition-all text-sm shadow-sm`;

// ─── Left panel ────────────────────────────────────────────────────────────────
const LeftPanel = () => (
  <div className="hidden lg:flex lg:w-[45%] flex-col justify-between relative overflow-hidden bg-white border-r border-slate-100">

    {/* Logo-inspired triangles — right side decorative cluster */}
    <svg className="absolute top-0 right-0 w-80 h-80 opacity-90" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
      <polygon points="200,0 320,70 200,140"  fill="#5ea62a" opacity="0.85" />
      <polygon points="240,0 320,45 240,90"   fill="#00b3c6" opacity="0.80" />
      <polygon points="200,140 320,210 200,280" fill="#9b1c1c" opacity="0.80" />
      <polygon points="240,90 320,155 240,220"  fill="#c0392b" opacity="0.85" />
      <polygon points="240,45 320,110 240,175"  fill="#1e2356" opacity="0.18" />
    </svg>

    {/* Bottom-left small echo */}
    <svg className="absolute bottom-10 left-0 w-28 h-28 opacity-30" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <polygon points="0,0 80,40 0,80"    fill="#5ea62a" />
      <polygon points="15,0 95,40 15,80"  fill="#c0392b" />
    </svg>

    {/* Top bar — red underline just like AltiusNxt website */}
    <div className="relative">
      <div className="px-12 pt-10 pb-6 border-b border-slate-100">
        <img src="/logo.png" alt="AltiusNxt" className="h-11 w-auto object-contain" />
        <div className="w-16 h-0.5 bg-brand-600 mt-3 rounded-full" />
      </div>
    </div>

    {/* Middle content */}
    <div className="relative px-12 space-y-7">
      <div>
        <h2 className="font-display font-bold text-slate-900 text-4xl leading-tight tracking-tight">
          HR built for<br />modern teams.
        </h2>
        <p className="text-slate-500 mt-4 text-sm leading-relaxed max-w-xs">
          Streamline attendance, leaves, timesheets, and HR operations in one unified platform.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          ['Attendance Tracking', 'Real-time check-in/out'],
          ['Leave Management', 'Smart approval flows'],
          ['Timesheets', 'Weekly work logs'],
          ['Reports & Analytics', 'Actionable insights'],
        ].map(([t, d]) => (
          <div key={t} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-600 mb-2" />
            <p className="text-slate-800 font-semibold text-sm">{t}</p>
            <p className="text-slate-400 text-xs mt-1">{d}</p>
          </div>
        ))}
      </div>
    </div>

    <p className="relative px-12 pb-8 text-slate-400 text-xs">
      © {new Date().getFullYear()} AltiusNxt HR Platform. All rights reserved.
    </p>
  </div>
);

// ─── Step indicators ───────────────────────────────────────────────────────────
const steps = ['Email', 'Access'];
const StepBar = ({ current }) => (
  <div className="flex items-center gap-2 mb-8">
    {steps.map((s, i) => (
      <React.Fragment key={s}>
        <div className="flex items-center gap-1.5">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${i < current ? 'bg-brand-600 text-white' : i === current ? 'bg-brand-600 text-white ring-2 ring-brand-500/20' : 'bg-slate-200 text-slate-400'}`}>
            {i < current ? <CheckCircle2 size={14} /> : i + 1}
          </div>
          <span className={`text-xs font-semibold ${i === current ? 'text-slate-800' : 'text-slate-400'}`}>{s}</span>
        </div>
        {i < steps.length - 1 && <div className={`flex-1 h-px transition-all ${i < current ? 'bg-brand-600' : 'bg-slate-200'}`} />}
      </React.Fragment>
    ))}
  </div>
);

// ─── STEP 1 — Email entry ──────────────────────────────────────────────────────
function StepEmail({ onNext }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const { checkEmail } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await checkEmail(email.trim());
      onNext(email.trim(), result);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not verify email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="mb-8">
        <h2 className="font-display font-bold text-slate-900 text-3xl">Sign in</h2>
        <p className="text-slate-400 mt-2 text-sm">Enter your work email to get started.</p>
      </div>
      <StepBar current={0} />
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="Work email" icon={Mail} required>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={inputCls()}
            placeholder="you@company.com"
            autoFocus
            required
          />
        </Field>
        <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-60 shadow-lg shadow-brand-500/20 text-sm">
          {loading
            ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <><span>Continue</span><ArrowRight size={15} /></>}
        </button>
      </form>
      {/* Demo shortcuts — only rendered in dev / test. Vite sets import.meta.env.PROD
       *  to true on `vite build`, so production bundles never contain these. */}
      {!import.meta.env.PROD && (
        <div className="mt-8">
          <p className="text-slate-400 text-xs font-semibold tracking-widest text-center mb-3">QUICK ACCESS (DEMO)</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { l: 'Admin', e: 'admin@nxtpeople.com', c: 'bg-purple-900/50 hover:bg-purple-800/60 border-purple-700/50 text-purple-300' },
              { l: 'Manager', e: 'sarah@nxtpeople.com', c: 'bg-blue-900/50 hover:bg-blue-800/60 border-blue-700/50 text-blue-300' },
              { l: 'Employee', e: 'michael@nxtpeople.com', c: 'bg-emerald-900/50 hover:bg-emerald-800/60 border-emerald-700/50 text-emerald-300' },
            ].map(({ l, e, c }) => (
              <button key={l} type="button" onClick={() => setEmail(e)} className={`text-xs py-2.5 rounded-lg border font-medium transition-all ${c}`}>{l}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Registration removed for Preboarding link system ────────────────────────

// ─── STEP 2b — Pending approval ────────────────────────────────────────────────
function StepPending({ email, firstName, onBack }) {
  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs mb-6 transition-colors">
        <ArrowLeft size={13} /> Use a different email
      </button>
      <div className="flex flex-col items-center text-center py-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5">
          <Clock size={28} className="text-amber-400" />
        </div>
        <h2 className="font-display font-bold text-slate-900 text-2xl mb-2">Awaiting Approval</h2>
        <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
          Hi <span className="text-brand-700 font-semibold">{firstName}</span>, your registration request is being reviewed by an administrator.
        </p>
        <div className="mt-6 w-full bg-amber-50 border border-amber-200 rounded-xl p-4 text-left">
          <p className="text-amber-700 text-xs font-semibold mb-1">What happens next?</p>
          <ul className="text-slate-500 text-xs space-y-1.5 list-disc list-inside">
            <li>An admin will review your request</li>
            <li>You'll be notified once approved</li>
            <li>Come back to this page to confirm and access the app</li>
          </ul>
        </div>
        <p className="text-slate-600 text-xs mt-4">{email}</p>
      </div>
    </>
  );
}

// ─── STEP 2c — Rejected ────────────────────────────────────────────────────────
function StepRejected({ email, onBack }) {
  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs mb-6 transition-colors">
        <ArrowLeft size={13} /> Back
      </button>
      <div className="flex flex-col items-center text-center py-6">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
          <XCircle size={28} className="text-red-400" />
        </div>
        <h2 className="font-display font-bold text-slate-900 text-2xl mb-2">Request Not Approved</h2>
        <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
          Your registration request for <span className="text-brand-700 font-semibold">{email}</span> was not approved. Please contact your HR administrator.
        </p>
      </div>
    </>
  );
}

// ─── STEP 2c — Accept terms ────────────────────────────────────────────────────
function StepAccept({ email, firstName, onBack }) {
  const [loading, setLoading] = useState(false);
  const { acceptTerms } = useAuth();
  const navigate = useNavigate();

  const handleAccept = async () => {
    setLoading(true);
    try {
      await acceptTerms(email);
      toast.success(`Welcome, ${firstName}!`);
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not complete setup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs mb-6 transition-colors">
        <ArrowLeft size={13} /> Back
      </button>
      <StepBar current={1} />
      <div className="flex flex-col items-center text-center py-4">
        <div className="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mb-5">
          <CheckCircle2 size={28} className="text-brand-400" />
        </div>
        <h2 className="font-display font-bold text-slate-900 text-2xl mb-2">You're approved!</h2>
        <p className="text-slate-400 text-sm mb-6 max-w-xs">
          Hi <span className="text-brand-700 font-semibold">{firstName}</span>, your account has been approved. Please confirm to access the platform.
        </p>
        <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-5 text-left text-sm text-slate-500 leading-relaxed mb-6 max-h-40 overflow-y-auto">
          <p className="text-slate-800 font-semibold text-sm mb-2">Platform Usage Agreement</p>
          <p>By confirming access, you agree to use Nxt People responsibly and in accordance with your organization's HR policies. All activity on this platform may be monitored and is subject to company guidelines. Your personal data will be processed as described in the company privacy policy.</p>
        </div>
        <button onClick={handleAccept} disabled={loading} className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-60 shadow-lg shadow-brand-500/20 text-sm">
          {loading
            ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <><CheckCircle2 size={15} /><span>I Accept — Continue to App</span></>}
        </button>
      </div>
    </>
  );
}

// ─── STEP 2d — Password login ──────────────────────────────────────────────────
function StepPassword({ email, firstName, onBack, onForgot, onMfaRequired }) {
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result?.mfaRequired) {
        onMfaRequired?.(result.mfaTicket);
        return;
      }
      toast.success('Welcome back!');
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs mb-6 transition-colors">
        <ArrowLeft size={13} /> {email}
      </button>
      <div className="mb-8">
        <h2 className="font-display font-bold text-slate-900 text-3xl">Welcome back</h2>
        <p className="text-slate-400 mt-1 text-sm">Hi <span className="text-slate-800 font-medium">{firstName}</span>, enter your password to continue.</p>
      </div>
      <StepBar current={1} />
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="Password" icon={Lock} required>
          <input
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={inputCls() + ' pr-12'}
            placeholder="••••••••"
            autoFocus
            required
          />
          <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
            {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </Field>
        <div className="flex justify-end">
          <button type="button" onClick={() => onForgot()} className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">
            Forgot password?
          </button>
        </div>
        <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-60 shadow-lg shadow-brand-500/20 text-sm">
          {loading
            ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <><span>Sign in</span><ArrowRight size={15} /></>}
        </button>
      </form>
    </>
  );
}

// ─── Submitted removed ────────────────────────────────────────────────────────

// ─── STEP Forgot Password ───────────────────────────────────────────────────────
function StepForgotPassword({ email, onBack }) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);

  const handleForgot = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      // The backend always returns the same generic message — even for unknown
      // emails — to prevent enumeration. The link itself goes via email; the
      // user clicks it to land on /reset-password/<token>.
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
        <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs mb-6 transition-colors">
          <ArrowLeft size={13} /> Back to sign in
        </button>
        <div className="flex flex-col items-center text-center py-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-5">
            <Mail size={28} className="text-emerald-500" />
          </div>
          <h2 className="font-display font-bold text-slate-900 text-2xl mb-2">Check your inbox</h2>
          <p className="text-slate-500 text-sm max-w-sm">
            If an account exists for <span className="text-slate-800 font-medium">{email}</span>,
            we've sent a password-reset link. The link expires in 10 minutes — open it on this
            device and you'll be taken straight to a "set new password" page.
          </p>
          <p className="text-slate-400 text-xs mt-4">
            Didn't get it? Check spam, or{' '}
            <button onClick={() => setSent(false)} className="text-brand-600 hover:underline">try again</button>.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs mb-6 transition-colors">
        <ArrowLeft size={13} /> Back to sign in
      </button>
      <div className="mb-8">
        <h2 className="font-display font-bold text-slate-900 text-3xl">Reset password</h2>
        <p className="text-slate-400 mt-2 text-sm">
          We'll email a reset link to <span className="text-slate-800 font-medium">{email}</span>.
        </p>
      </div>
      <form onSubmit={handleForgot} className="space-y-5">
        <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-60 shadow-lg shadow-brand-500/20 text-sm">
          {loading
            ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <><span>Send Reset Email</span><ArrowRight size={15} /></>}
        </button>
      </form>
    </>
  );
}

// ─── STEP Reset Password ────────────────────────────────────────────────────────
function StepResetPassword({ token, onBack, onDone }) {
  const [newPassword, setNewPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleReset = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put(`/auth/reset-password/${token}`, { newPassword });
      toast.success('Password reset successfully — please log in with your new password.');
      // Always invalidate the current session after a reset. The user might
      // have clicked the email link in the same browser where they were
      // still signed in; without this, they'd remain on the old session
      // and the new password would only take effect at the next logout.
      localStorage.removeItem('nxt_token');
      localStorage.removeItem('nxt_refresh_token');
      delete api.defaults.headers.common.Authorization;
      // Hard reload to /login so AuthContext re-initialises with no user.
      setTimeout(() => { window.location.assign('/login'); }, 800);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs mb-6 transition-colors">
        <ArrowLeft size={13} /> Back
      </button>
      <div className="mb-8">
        <h2 className="font-display font-bold text-slate-900 text-3xl">New password</h2>
        <p className="text-slate-400 mt-2 text-sm">Enter your new password.</p>
      </div>
      <form onSubmit={handleReset} className="space-y-5">
        <Field label="New Password" icon={Lock} required>
          <input
            type={showPass ? 'text' : 'password'}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className={inputCls() + ' pr-12'}
            placeholder="••••••••"
            required
            minLength={6}
          />
          <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
            {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </Field>
        <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-60 shadow-lg shadow-brand-500/20 text-sm">
          {loading
            ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <><span>Save Password</span><CheckCircle2 size={15} /></>}
        </button>
      </form>
    </>
  );
}

// ─── STEP 2e — MFA challenge (after password, when MFA is enabled) ────────────
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
      <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs mb-6 transition-colors">
        <ArrowLeft size={13} /> {email}
      </button>
      <h2 className="text-2xl font-bold text-slate-800 mb-1">Two-factor authentication</h2>
      <p className="text-slate-500 text-sm mb-6">
        {useBackup
          ? 'Enter one of your saved backup codes (e.g. ABCD-EFGH).'
          : 'Enter the 6-digit code from your authenticator app.'}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(useBackup ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))}
          inputMode={useBackup ? 'text' : 'numeric'}
          maxLength={useBackup ? 9 : 6}
          placeholder={useBackup ? 'ABCD-EFGH' : '123456'}
          className="w-full border border-slate-300 rounded-md px-4 py-3 text-[16px] font-mono tracking-widest text-center focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="w-full bg-[#1a73e8] hover:bg-[#1557B0] text-white py-3 rounded-md text-[14px] font-semibold disabled:opacity-50"
        >
          {loading ? 'Verifying…' : 'Verify & continue'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => { setUseBackup((v) => !v); setCode(''); }}
        className="mt-4 text-[12.5px] text-[#1a73e8] hover:text-[#1557B0]"
      >
        {useBackup ? 'Use authenticator code instead' : 'Use a backup code instead'}
      </button>
    </>
  );
}

// ─── Main Login component ──────────────────────────────────────────────────────
export default function Login() {
  const { token } = useParams();
  const [step, setStep] = useState(token ? 'reset' : 'email'); // email | register | pending | rejected | accept | password | mfa | submitted | forgot | reset
  const [emailData, setEmailData] = useState({ email: '', status: null, hasAccepted: false, firstName: '' });
  const [resetToken, setResetToken] = useState(token || '');
  const [mfaTicket, setMfaTicket] = useState('');

  useEffect(() => {
    if (token) {
      setStep('reset');
      setResetToken(token);
    }
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

  return (
    <div className="min-h-screen bg-white flex">
      <LeftPanel />
      <div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-16 overflow-y-auto bg-slate-50">
        <div className="max-w-md w-full mx-auto py-12">
          {step === 'email' && <StepEmail onNext={handleEmailNext} />}
          {step === 'pending' && <StepPending email={emailData.email} firstName={emailData.firstName} onBack={reset} />}
          {step === 'rejected' && <StepRejected email={emailData.email} onBack={reset} />}
          {step === 'accept' && <StepAccept email={emailData.email} firstName={emailData.firstName} onBack={reset} />}
          {step === 'password' && <StepPassword
            email={emailData.email}
            firstName={emailData.firstName}
            onBack={reset}
            onForgot={() => setStep('forgot')}
            onMfaRequired={(ticket) => { setMfaTicket(ticket); setStep('mfa'); }}
          />}
          {step === 'mfa' && <StepMfa email={emailData.email} mfaTicket={mfaTicket} onBack={() => setStep('password')} />}
          {step === 'forgot' && <StepForgotPassword email={emailData.email} onBack={() => setStep('password')} />}
          {step === 'reset' && <StepResetPassword token={resetToken} onBack={() => setStep('forgot')} onDone={() => {
            if (emailData.email) setStep('password');
            else setStep('email');
          }} />}
        </div>
      </div>
    </div>
  );
}
