import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import api from './api';

// "Password protection for file export" — Leave Tracker > Configuration >
// Additional Options, and the same switch under Attendance. Both screens say
// the same thing: once enabled, files with that data are sent to your email,
// encrypted with a password.
//
// So when it is on, the workbook is not written to disk here. It goes to the
// server, which zips it with AES-256, mails it, and hands back the password —
// which is shown once, in the session that asked. Mailing the password beside
// the file it protects would protect nothing.
//
// Every report export in the app comes through here, so the two switches
// cannot end up applying to some exports and not others.

let cache = null;   // { attendance: bool, leave: bool, at: number }
const TTL_MS = 60_000;

async function protection() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const out = { attendance: false, leave: false, at: Date.now() };
  // A failed read must not block an export. The worst case is a plain download
  // when the setting wanted protection, and the server refuses a protected
  // request whose setting is off anyway, so the two cannot disagree silently.
  try {
    const [a, l] = await Promise.allSettled([
      api.get('/attendance-config/additional'),
      api.get('/leave-config/additional'),
    ]);
    if (a.status === 'fulfilled') out.attendance = !!a.value.data?.data?.passwordProtectExport;
    if (l.status === 'fulfilled') out.leave = !!l.value.data?.data?.passwordProtectExports;
  } catch { /* defaults stand */ }
  cache = out;
  return out;
}

/** Called after a save so a change takes effect without a reload. */
export const forgetProtection = () => { cache = null; };

// Which switch governs this export. Derived from the route rather than passed
// at every call site, because a caller that forgets would silently opt out of
// the protection the admin switched on.
function kindOf(explicit) {
  if (explicit) return explicit;
  const p = (typeof window !== 'undefined' && window.location?.pathname) || '';
  if (p.includes('/reports/attendance') || p.includes('/attendance')) return 'attendance';
  if (p.includes('/reports/leave') || p.includes('/leave')) return 'leave';
  return null;
}

/**
 * Write the workbook out, or send it, depending on the setting.
 *
 * @param wb        a SheetJS workbook
 * @param filename  including extension
 * @param opts.kind 'attendance' | 'leave' — inferred from the route if absent
 * @param opts.bookType passed through to SheetJS ('xlsx' | 'biff8')
 */
export async function deliverWorkbook(wb, filename, opts = {}) {
  const bookType = opts.bookType || 'xlsx';
  const kind = kindOf(opts.kind);
  const guard = await protection();

  if (!kind || !guard[kind]) {
    XLSX.writeFile(wb, filename, { bookType });
    return { delivered: 'download' };
  }

  // xls (biff8) is not offered by mail: the point of this path is an encrypted
  // container, and the legacy format buys nothing once it is inside one.
  const b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
  const name = filename.replace(/\.(xls|xlsx)$/i, '') + '.xlsx';

  const pending = toast.loading('Encrypting and sending your export…');
  try {
    const r = await api.post('/exports/protected', { kind, filename: name, contentBase64: b64 });
    toast.dismiss(pending);
    const password = r.data?.password;
    const to = r.data?.sentTo;
    // A long-lived toast rather than a passing one: this is the only place the
    // password appears, and a message that fades in four seconds would lose it.
    toast.success(
      `Sent to ${to}. Password: ${password}\nIt is not in the email — copy it now.`,
      { duration: 60000, style: { maxWidth: '520px' } }
    );
    return { delivered: 'email', password, sentTo: to };
  } catch (err) {
    toast.dismiss(pending);
    toast.error(err.response?.data?.message || 'Could not send the protected export');
    return { delivered: 'failed' };
  }
}
