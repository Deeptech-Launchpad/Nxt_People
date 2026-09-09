import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

/* Settings → User Access Control → Function Based Permissions, read by the
 * screens it governs.
 *
 * The backend enforces these too — this is not the security boundary. It is
 * what stops a person being shown a control that will refuse them, which is
 * the difference between a feature being switched off and a feature being
 * broken.
 *
 * Loads once per session. While it is loading, `can()` answers true: the
 * alternative is every gated control flickering out of existence on each page
 * load, and a control shown for half a second that the API then refuses is a
 * far smaller problem than the whole UI dropping and reappearing.
 */

/* Answers true to any option asked of it.
 *
 * `can()` fails OPEN when permissions have not loaded — see the note above.
 * `optionOf()` returned a bare {} in the same situation, which fails CLOSED:
 * every option-gated control disappeared, while the plain can() ones stayed.
 * Announcements showed the effect exactly — an admin saw the page and its
 * "post an announcement" subtitle, and no New Announcement button, with
 * nothing on screen to say why.
 *
 * A Proxy rather than a fixed shape because the option names differ per
 * function (manage, export, approve...) and this must not have to know them. */
const ALL_OPTIONS_ALLOWED = new Proxy({}, { get: () => true });

const FunctionAccessContext = createContext({
  functions: null,
  loading: true,
  can: () => true,
  optionOf: () => ALL_OPTIONS_ALLOWED,
  reload: () => {},
});

export const useFunctionAccess = () => useContext(FunctionAccessContext);

export const FunctionAccessProvider = ({ children }) => {
  const [functions, setFunctions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    api.get('/access-control/my-functions')
      .then(r => {
        setFunctions(r.data?.data?.functions || null);
        setLoadError(null);
      })
      /* A failure here must not switch the application off. Left null, `can()`
       * answers true and `optionOf()` allows every option, so every screen
       * behaves as it did before this existed and the API stays the real
       * boundary. The error is kept rather than discarded: swallowing it
       * turned a failed request into a silently missing button, which is a
       * genuinely hard thing to diagnose from the UI. */
      .catch(err => {
        setFunctions(null);
        setLoadError(err?.message || 'Could not load function permissions');
        console.warn('[FunctionAccess] permissions did not load; controls fall back to allowed:', err);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Mounted for the whole app, /login included — calling this while logged
    // out 401s, and that 401 triggers api.js's hard redirect to /login, which
    // reloads the whole app and fires this same call again. Infinite loop.
    if (!localStorage.getItem('nxt_token')) { setLoading(false); return; }
    reload();
  }, [reload]);

  const can = useCallback(
    key => (functions ? !!functions[key]?.allowed : true),
    [functions]
  );

  /* Matches can()'s stance: with no permissions loaded, allow the option and
   * let the API refuse it, rather than hiding the control with no explanation. */
  const optionOf = useCallback(
    key => (functions ? functions[key]?.options || {} : ALL_OPTIONS_ALLOWED),
    [functions]
  );

  return (
    <FunctionAccessContext.Provider value={{ functions, loading, loadError, can, optionOf, reload }}>
      {children}
    </FunctionAccessContext.Provider>
  );
};
