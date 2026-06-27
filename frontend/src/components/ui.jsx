import React from 'react';

// Modal
export const Modal = ({ open, onClose, title, children, size = 'lg' }) => {
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-xl', xl: 'max-w-2xl', '2xl': 'max-w-3xl' };
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal w-full ${sizes[size]}`}>
        <div className="modal-header">
          <h3 className="text-xl font-display font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

// Spinner
export const Spinner = ({ size = 'md', className = '' }) => {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8', xl: 'w-12 h-12' };
  return (
    <svg className={`animate-spin text-brand-500 ${sizes[size]} ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
};

export const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="text-center">
      <Spinner size="xl" className="mx-auto mb-4" />
      <p className="text-slate-500 text-base">Loading...</p>
    </div>
  </div>
);

// Empty state
export const EmptyState = ({ icon, title, subtitle, action }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4 text-slate-400">
      {icon || (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      )}
    </div>
    <h3 className="font-display font-bold text-slate-700 mb-1">{title}</h3>
    {subtitle && <p className="text-slate-500 text-base max-w-xs">{subtitle}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

// Stat Card
export const StatCard = ({ label, value, icon, color = 'brand', trend, sub }) => {
  const colors = {
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
    blue: 'bg-blue-50 text-blue-600',
  };
  return (
    <div className="stat-card">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="text-3xl font-display font-bold text-slate-900 mt-0.5">{value ?? '—'}</p>
        {sub && <p className="text-sm text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
};

// Alert
export const Alert = ({ type = 'info', message, onClose }) => {
  const styles = {
    info: 'bg-blue-50 text-blue-800 border-blue-200',
    success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    error: 'bg-red-50 text-red-800 border-red-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
  };
  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border text-base ${styles[type]} animate-slide-in`}>
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="opacity-60 hover:opacity-100">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

// Pagination
export const Pagination = ({ page, pages, onPage }) => {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 mt-4">
      <button disabled={page === 1} onClick={() => onPage(page - 1)} className="btn-secondary btn-sm disabled:opacity-40">←</button>
      {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
        <button key={p} onClick={() => onPage(p)}
          className={`w-8 h-8 text-base rounded-lg font-medium transition-all ${p === page ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
          {p}
        </button>
      ))}
      <button disabled={page === pages} onClick={() => onPage(page + 1)} className="btn-secondary btn-sm disabled:opacity-40">→</button>
    </div>
  );
};

// Status badge helper
export const StatusBadge = ({ status }) => {
  const map = {
    present: 'badge-present', absent: 'badge-absent', late: 'badge-late',
    'half-day': 'badge-halfday', leave: 'badge-leave', holiday: 'badge-approved',
    pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected',
    draft: 'badge-draft', submitted: 'badge-submitted', active: 'badge-approved', inactive: 'badge-absent',
  };
  const labels = { 'half-day': 'Half Day' };
  return <span className={map[status] || 'badge bg-slate-100 text-slate-600'}>{labels[status] || status}</span>;
};

// Form field wrapper
export const FormField = ({ label, required, children, error }) => (
  <div>
    <label className="label">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
    {children}
    {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
  </div>
);

// Select input
export const Select = ({ value, onChange, options, placeholder, className = '' }) => (
  <select value={value} onChange={onChange} className={`input ${className}`}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(o => (
      <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
    ))}
  </select>
);

// Avatar — initials-only (legacy callers)
export const Avatar = ({ name, size = 'md' }) => {
  const sizes = { sm: 'w-7 h-7 text-sm', md: 'w-9 h-9 text-base', lg: 'w-12 h-12 text-lg' };
  const initials = name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div className={`rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold flex-shrink-0 ${sizes[size]}`}>
      {initials}
    </div>
  );
};

// PhotoAvatar — renders the employee's photo if set, falls back to an
// initials bubble. Avoids the ui-avatars.com pattern being duplicated
// across half a dozen pages, and keeps fallbacks working when the network
// can't reach ui-avatars (private network deployments, CSP rules, etc.).
// className lets the caller control size/border/etc. without us having to
// enumerate every variant.
export const PhotoAvatar = ({ photoUrl, firstName, lastName, name, className = 'w-9 h-9', textClassName = 'text-sm' }) => {
  const display = name || `${firstName || ''} ${lastName || ''}`.trim();
  const initials = display
    ? display.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  const [broken, setBroken] = React.useState(false);
  const src = (!broken && photoUrl) ? photoUrl : null;
  if (src) {
    return (
      <img
        src={src}
        alt={display || 'avatar'}
        onError={() => setBroken(true)}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
      />
    );
  }
  return (
    <div className={`rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold flex-shrink-0 ${className} ${textClassName}`}>
      {initials}
    </div>
  );
};
