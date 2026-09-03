import toast from 'react-hot-toast';
import api from './api';

/* Open or save one employee document.
 *
 * The old inline version did this:
 *
 *     fetch(doc.filePath).then(r => r.blob()).then(saveAs)
 *
 * with no check that the response was a file. When the bytes were missing the
 * server answered `{"success":false,"message":"... not found"}` with a 404,
 * and that JSON became the blob — so an administrator got a 95-byte file
 * called "10th Certificate.json" saved to their machine and nothing on screen
 * to say it had failed. A download that quietly saves an error message is
 * worse than one that refuses.
 *
 * It also fetched /uploads/<random>.pdf directly, which was guarded only by
 * "do you hold a valid token" — not "are these your papers". Everything now
 * goes through /documents/:employeeId/:docId/file, which asks the real
 * question and writes down who looked.
 */
const friendly = async (res) => {
  /* The server's own sentence where there is one. It says something useful —
   * that the record exists but the file does not, which is a different problem
   * from a permission refusal and has a different fix. */
  try {
    const text = await res.data.text();
    const parsed = JSON.parse(text);
    if (parsed?.message) return parsed.message;
  } catch { /* not JSON: fall through to the status */ }
  if (res.status === 403) return 'You do not have access to that document.';
  if (res.status === 404) return 'That document is no longer on the server.';
  return 'That document could not be opened.';
};

async function fetchDoc(employeeId, docId, inline) {
  return api.get(`/documents/${employeeId}/${docId}/file${inline ? '?disposition=inline' : ''}`, {
    responseType: 'blob',
  });
}

/* A blob that is JSON is an error wearing a file's clothes. Checked before
 * anything is saved or opened. */
const looksLikeError = (blob) =>
  blob && (blob.type === 'application/json' || blob.type === 'text/html');

export async function previewEmployeeDocument(employeeId, docId, label = 'Document') {
  const t = toast.loading(`Opening ${label}…`);
  try {
    const r = await fetchDoc(employeeId, docId, true);
    if (looksLikeError(r.data)) throw { response: { ...r, data: r.data } };
    const url = URL.createObjectURL(r.data);
    const w = window.open(url, '_blank');
    if (!w) toast.error('Your browser blocked the preview window. Allow pop-ups for this site.', { id: t });
    else toast.dismiss(t);
    /* Long enough for the tab to read it, then released — an object URL held
     * for the life of the tab leaks the whole file's bytes. */
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    toast.error(err?.response ? await friendly(err.response) : 'That document could not be opened.', { id: t });
  }
}

export async function downloadEmployeeDocument(employeeId, docId, filename = 'document') {
  const t = toast.loading(`Preparing ${filename}…`);
  try {
    const r = await fetchDoc(employeeId, docId, false);
    if (looksLikeError(r.data)) throw { response: { ...r, data: r.data } };
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url;
    /* The server names the file; this is only the fallback for a browser that
     * ignores Content-Disposition. */
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Downloaded', { id: t });
  } catch (err) {
    toast.error(err?.response ? await friendly(err.response) : 'That document could not be downloaded.', { id: t });
  }
}
