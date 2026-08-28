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

const FunctionAccessContext = createContext({
  functions: null,
  loading: true,
  can: () => true,
  optionOf: () => ({}),
  reload: () => {},
});

export const useFunctionAccess = () => useContext(FunctionAccessContext);

export const FunctionAccessProvider = ({ children }) => {
  const [functions, setFunctions] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api.get('/access-control/my-functions')
      .then(r => setFunctions(r.data?.data?.functions || null))
      /* A failure here must not switch the application off. Left null, `can()`
       * answers true and every screen behaves as it did before this existed. */
      .catch(() => setFunctions(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const can = useCallback(
    key => (functions ? !!functions[key]?.allowed : true),
    [functions]
  );

  const optionOf = useCallback(
    key => (functions ? functions[key]?.options || {} : {}),
    [functions]
  );

  return (
    <FunctionAccessContext.Provider value={{ functions, loading, can, optionOf, reload }}>
      {children}
    </FunctionAccessContext.Provider>
  );
};
