import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Lock, Info } from 'lucide-react';
import api from '../../../utils/api';

/* Settings -> Employee Information -> Extend Service.
 *
 * Forms: which optional record types this module offers. Employee, Department
 * and Designation are what the module IS, so they carry no switch — the
 * reference gives them none either.
 */
function Toggle({ on, onChange, disabled, title }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} title={title}
      onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 relative
        ${on ? 'bg-brand-600' : 'bg-slate-300'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export function Forms() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/employee-info-settings/forms')
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load forms'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const flip = async (row, value) => {
    const before = rows;
    setRows(rs => rs.map(r => r.key === row.key ? { ...r, isEnabled: value } : r));
    try { await api.patch(`/employee-info-settings/forms/${row.key}`, { isEnabled: value }); toast.success('Saved'); }
    catch (err) { setRows(before); toast.error(err.response?.data?.message || 'Could not save that'); }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-[14px] text-slate-500">
        Optional record types this module offers. Employee, Department and Designation are the module
        itself and cannot be switched off.
      </p>

      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <table className="w-full text-[15px]">
          <thead className="bg-slate-50 text-slate-500 text-[13.5px]">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Form name</th>
              <th className="px-4 py-2.5 text-left font-medium w-40">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={2} className="py-14 text-center">
                <div className="inline-block w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </td></tr>
            ) : rows.map(r => (
              <tr key={r.key} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-800">
                  <span className="inline-flex items-center gap-2">
                    {r.label}
                    {r.isCore && (
                      <span className="inline-flex items-center gap-1 text-[12px] text-slate-400">
                        <Lock size={11} /> core
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {r.isCore
                    ? <span className="text-[13.5px] text-slate-400">Always on</span>
                    : <Toggle on={r.isEnabled} onChange={v => flip(r, v)} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Switching one on creates the setting, not the screens behind it.
          Better said here than discovered by an admin who turns it on and
          finds nothing changed. */}
      <p className="text-[13.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
        Employee Health Data and Vaccination Status record the choice today; the forms themselves are
        not built yet, so switching one on does not add a screen.
      </p>
    </div>
  );
}

export function CustomButton() {
  return (
    <div className="max-w-3xl">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="text-[16px] font-semibold text-slate-800">Custom Button</h3>
        <p className="text-[14px] text-slate-500 mt-1">
          Buttons on a record that run an action — send an email alert, or update a field — optionally
          only when criteria are met.
        </p>

        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mt-4">
          <Info size={17} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-[14px] text-amber-800">
            <p className="font-medium">Not built yet — and Custom Functions will not be.</p>
            <p className="mt-1">
              The reference runs administrator-written scripts on its servers. We will not execute
              arbitrary code here, so custom buttons will offer criteria, email alerts and field updates
              only. A code box that never runs would be worse than not offering one.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WebForms() {
  return (
    <div className="max-w-3xl">
      <div className="bg-white border border-slate-200 rounded-xl py-14 text-center">
        <p className="text-[15px] text-slate-600">No forms available</p>
        <p className="text-[14px] text-slate-400 mt-1">
          Public web forms are not built yet.
        </p>
      </div>
    </div>
  );
}
