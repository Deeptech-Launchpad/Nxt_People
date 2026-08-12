// Minimal iCalendar writer for the leave/attendance grids — "Download as ICS"
// gives you a file you can drop into Outlook or Google Calendar so a team's
// leave shows up alongside everything else.
//
// All-day events use DTSTART;VALUE=DATE with DTEND exclusive (the day after),
// which is what the spec requires and what calendar clients expect; getting
// that wrong renders every event a day short.

const pad = n => String(n).padStart(2, '0');
const toIcsDate = d => {
  const dt = new Date(d);
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
};
const nextDay = d => {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + 1);
  return toIcsDate(dt);
};

// Folds long lines at 75 octets, as the spec requires — unfolded SUMMARY lines
// are the usual reason an .ics silently fails to import.
const fold = line => {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) { parts.push(` ${rest.slice(0, 74)}`); rest = rest.slice(74); }
  if (rest) parts.push(` ${rest}`);
  return parts.join('\r\n');
};

const escape = s => String(s ?? '').replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');

// `events` is [{ date, summary, uid }].
export function buildIcs(events, calendarName = 'Report') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NXT People//Reports//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${escape(calendarName)}`),
  ];
  events.forEach((e, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid || `nxt-${i}-${toIcsDate(e.date)}@nxtpeople`}`,
      `DTSTAMP:${toIcsDate(new Date())}T000000Z`,
      `DTSTART;VALUE=DATE:${toIcsDate(e.date)}`,
      `DTEND;VALUE=DATE:${nextDay(e.date)}`,
      fold(`SUMMARY:${escape(e.summary)}`),
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(events, fileStub, calendarName) {
  const blob = new Blob([buildIcs(events, calendarName || fileStub)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${fileStub}.ics`; a.click();
  URL.revokeObjectURL(url);
}
