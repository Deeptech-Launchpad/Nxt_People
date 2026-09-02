import React from 'react';
import { Info } from 'lucide-react';

/* Settings -> Employee Information -> Approvals.
 *
 * The reference approves changes to the RECORD: somebody edits their own
 * profile, and the change waits for HR to consent before it lands. That is a
 * different thing from the approval engine we already have, which approves
 * REQUESTS — leave, regularization, on duty, comp-off.
 *
 * Wiring this tab to that engine would list Leave and Regularization under
 * Employee Information, or nothing at all. Both read as broken. Saying what is
 * missing is more use than either.
 */
export default function EmpApprovals() {
  return (
    <div className="max-w-3xl">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="text-[16px] font-semibold text-slate-800">Approvals</h3>
        <p className="text-[14px] text-slate-500 mt-1">
          Require consent before a change to an employee, department or designation record takes effect.
        </p>

        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mt-4">
          <Info size={17} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-[14px] text-amber-800">
            <p className="font-medium">Not built yet.</p>
            <p className="mt-1">
              Record-change approvals need edits to be held pending rather than written straight through,
              which is a change to how the employee record saves — not a setting. The approval engine we
              already have covers <strong>requests</strong>: leave, regularization, on duty and
              compensatory off, each configured under its own service.
            </p>
          </div>
        </div>

        <p className="text-[13.5px] text-slate-500 mt-4">
          Every change to an employee record is already recorded with its old and new value under
          <strong> User-specific Operations → Audit History</strong>.
        </p>
      </div>
    </div>
  );
}
