import toast from 'react-hot-toast';
import api from '../../utils/api';

/* Ask the server for a file and hand it to the browser.
 *
 * Written once because every caller gets the same two details wrong: the
 * response has to be a blob (the default JSON parse corrupts binary), and the
 * object URL has to be revoked or every export leaks a few hundred KB for the
 * life of the tab.
 */
export default async function downloadFile(path, filename) {
  const t = toast.loading('Preparing your file…');
  try {
    const r = await api.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Downloaded', { id: t });
  } catch (err) {
    /* An error response to a blob request arrives AS a blob, so
     * err.response.data.message is undefined and the real reason is inside the
     * blob text. Read it rather than showing a generic failure. */
    let message = 'Could not download that file';
    try {
      const text = await err.response?.data?.text?.();
      if (text) message = JSON.parse(text).message || message;
    } catch { /* not JSON — keep the generic message */ }
    toast.error(message, { id: t });
  }
}
