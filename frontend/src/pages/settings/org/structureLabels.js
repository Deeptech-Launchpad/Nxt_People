import { useCallback, useEffect, useState } from 'react';
import api from '../../../utils/api';

// The three component names are configuration, not fixed strings — an
// organization can call a legal entity a "Company", a "Firm" or anything else,
// and the reference renames the rail item, the screen heading and the buttons
// with it. Every structure screen reads them from here so one rename shows up
// everywhere rather than in whichever screen remembered to look.
export const DEFAULT_LABELS = {
  legalEntity: 'Company',
  businessUnit: 'Business Unit',
  division: 'Division',
};

export function useStructure() {
  const [state, setState] = useState({ loading: true, enabled: false, labels: DEFAULT_LABELS });

  const load = useCallback(() => {
    api.get('/org-details/structure')
      .then(r => setState({
        loading: false,
        enabled: !!r.data.data.enabled,
        labels: { ...DEFAULT_LABELS, ...(r.data.data.labels || {}) },
      }))
      // A failed read must not blank the screen: the built-in names are right
      // for an organization that never renamed them, which is most of them.
      .catch(() => setState({ loading: false, enabled: false, labels: DEFAULT_LABELS }));
  }, []);

  useEffect(load, [load]);
  return { ...state, reload: load };
}
