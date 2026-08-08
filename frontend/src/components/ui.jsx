import React from 'react';

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
