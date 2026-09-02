import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import api from '../../../utils/api';

/* Settings -> Employee Information -> Approvals.
 *
 * Record-change approvals: an edit to an employee, department or designation
 * is held pending consent rather than written straight through.
 *
 * The screen leads with what switching it on actually does, because this is
 * not a display preference — it changes how the record saves, and an admin who
 * turns it on without reading will find their next edit sitting in a queue.
 */
const FORM_LABEL = { employee: 'Employee', department: 'Department', designation: 'Designation' };

function Toggle({ on, onChange, disabled }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 relative
        ${on ? 'bg-brand-600' : 'bg-slate-300'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function EmpApprovals() {
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/record-approvals/config')
      .then(r => { setRows(r.data.data || []); setRoles(r.data.roles || []); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load approvals'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const patch = async (form, body) => {
    const before = rows;
    setRows(rs => rs.map(r => r.form === form ? { ...r, ...body } : r));
    try { await api.patch(`/record-approvals/config/${form}`, body); toast.success('Saved'); }
    catch (err) { setRows(before); toast.error(err.response?.data?.message || 'Could not save'); }
  };

  const toggleRole = (row, role) => {
    const has = (row.approverRoles || []).includes(role);
    const next = has ? row.approverRoles.filter(r => r !== role) : [...(row.approverRoles || []), role];
    if (!next.length) return toast.error('Choose at least one approver role');
    patch(row.form, { approverRoles: next });
  };

  if (loading) {
    return <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-[14px] text-slate-500">
        Hold a change to a record until somebody consents to it. Requests appear under
        <strong> Operations → Employee Information</strong> for the approver roles you choose.
      </p>

      {rows.map(row => (
        <div key={row.form} className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <Toggle on={row.isEnabled} onChange={v => patch(row.form, { isEnabled: v })} />
            <div className="flex-1 min-w-0">
              <h3 className="text-[16px] font-semibold text-slate-800">
                {FORM_LABEL[row.form] || row.form}
              </h3>
              <p className="text-[14px] text-slate-500 mt-0.5">
                {row.isEnabled
                  ? 'Edits are held until an approver consents.'
                  : 'Edits are written straight through, as they are today.'}
              </p>

              {row.form !== 'employee' && row.isEnabled && (
                /* Only the employee record's update route asks shouldHold().
                 * Saying so beats a switch that appears on and does nothing. */
                <p className="text-[13.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
                  Departments and designations are not held yet — only the employee record asks for
                  approval. This switch is recorded and will apply when that is wired.
                </p>
              )}

              {row.isEnabled && (
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-[14px] font-medium text-slate-700 mb-1.5">Approver roles</p>
                    <div className="flex flex-wrap gap-1.5">
                      {roles.map(r => {
                        const on = (row.approverRoles || []).includes(r);
                        return (
                          <button key={r} onClick={() => toggleRole(row, r)}
                            className={`px-2.5 py-1 rounded-lg text-[13.5px] border capitalize transition-colors
                              ${on ? 'bg-brand-50 border-brand-300 text-brand-700'
                                   : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                            {String(r).replace(/_/g, ' ')}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={row.skipForFullAccess}
                      onChange={e => patch(row.form, { skipForFullAccess: e.target.checked })}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 accent-brand-600" />
                    <span className="text-[14.5px] text-slate-700">
                      Full access edits without approval
                      <span className="block text-[13px] text-slate-500 mt-0.5">
                        On by default. HR editing a record is the normal path, and holding their own
                        edit pending their own approval is a loop.
                      </span>
                    </span>
                  </label>

                  {!row.skipForFullAccess && (
                    /* The consequence, stated where the decision is made. */
                    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-lg px-3.5 py-2.5">
                      <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-[13.5px] text-amber-800">
                        <strong>Everyone</strong> now needs approval, including administrators. Your own
                        next edit will wait in the queue, and you cannot approve it yourself — somebody
                        else has to. Make sure at least one other person holds an approver role.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <ShieldCheck size={17} className="text-slate-400 mt-0.5 flex-shrink-0" />
        <p className="text-[13.5px] text-slate-600">
          Whether or not approvals are on, every change to an employee record is recorded with its old
          and new value under <strong>User-specific Operations → Audit History</strong>.
        </p>
      </div>
    </div>
  );
}
