import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { isWeekendByRules, legacyIsWeekend } from '../utils/weekendRules';

const WeekendRulesContext = createContext({
  rules: null,
  holidays: [],
  loading: true,
  isWeekend: legacyIsWeekend,
  reload: () => {},
});

export const useWeekendRules = () => useContext(WeekendRulesContext);

/** YYYY-MM-DD in local time. */
function isoDate(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export const WeekendRulesProvider = ({ children }) => {
  const [rules, setRules]       = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading]   = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    const year = new Date().getFullYear();
    Promise.all([
      api.get('/weekend-rules'),
      api.get(`/holidays?year=${year}`),
    ])
      .then(([rRules, rHolidays]) => {
        setRules(rRules.data.data || []);
        setHolidays(rHolidays.data.data || []);
      })
      .catch(() => { setRules([]); setHolidays([]); })   // fall back to legacy
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('nxt_token');
    if (!token) { setLoading(false); return; }
    reload();
  }, [reload]);

  /**
   * Final weekend decision, matching the backend `isNonWorkingDay()` precedence:
   *   1. Holiday row with type='working_day' → forced WORKING DAY
   *   2. A holiday row that closes the office → non-working
   *   3. Otherwise (no row, or an optional 'restricted' one) → consult the
   *      weekend rules. A restricted holiday is offered, not imposed, so it
   *      leaves the day as it was for anyone who hasn't taken it.
   *
   * Falls back to the legacy hardcoded rule during the initial fetch so UI
   * doesn't misclassify days while the API is in flight.
   */
  const isWeekend = useCallback(
    (date) => {
      if (rules === null) return legacyIsWeekend(date);
      const ymd = isoDate(date);
      const exception = holidays.find(h => h.date && isoDate(new Date(h.date)) === ymd);
      if (exception) {
        if (exception.type === 'working_day') return false; // override wins
        if (exception.type !== 'restricted') return true;   // closure
      }
      const active = rules.filter(r => r.isActive !== false);
      return active.length > 0
        ? isWeekendByRules(date, active)
        : legacyIsWeekend(date);
    },
    [rules, holidays]
  );

  return (
    <WeekendRulesContext.Provider value={{ rules, holidays, loading, isWeekend, reload }}>
      {children}
    </WeekendRulesContext.Provider>
  );
};
