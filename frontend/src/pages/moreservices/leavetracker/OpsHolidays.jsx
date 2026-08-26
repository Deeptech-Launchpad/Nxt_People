import React from 'react';
import HolidayTable from './HolidayTable';

/* Holidays — the days the office is shut. Working-day exceptions are the same
 * record pointing the other way and live in their own tab, exactly as Zoho
 * separates them. One table serves both so a column added here cannot be
 * forgotten there. */
export default function OpsHolidays() {
  return <HolidayTable mode="holiday" />;
}
