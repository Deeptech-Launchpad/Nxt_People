import { useEffect, useState } from 'react';
import api from '../../../utils/api';

/* Every active employee, for the pickers on the Operations tabs.
 *
 * The whole point of the Operations door is choosing somebody other than
 * yourself, so four of these tabs need the same list. One hook rather than four
 * copies of the same fetch, because the day the endpoint or the shape changes,
 * three of four copies is exactly the kind of thing that gets missed. */
export default function useEmployeeList() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    api.get('/employees?limit=500&status=active')
      .then(r => { if (live) setPeople(r.data.data || []); })
      .catch(() => { if (live) setPeople([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  return { people, loading };
}

/** "ANXT220012 — Amarnath Ramarao A", the way Zoho labels its own pickers. */
export const labelOf = (p) =>
  `${p.employeeId ? `${p.employeeId} — ` : ''}${p.firstName || ''} ${p.lastName || ''}`.trim();
