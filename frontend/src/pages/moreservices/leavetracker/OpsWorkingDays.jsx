import React from 'react';
import HolidayTable from './HolidayTable';

/* Exceptional Working days — a weekend the company actually worked. Stored as
 * a holidays row with type 'working_day', which the classifier reads as a
 * positive override: the day IS judged, and working it earns no comp-off. */
export default function OpsWorkingDays() {
  return <HolidayTable mode="working_day" />;
}
