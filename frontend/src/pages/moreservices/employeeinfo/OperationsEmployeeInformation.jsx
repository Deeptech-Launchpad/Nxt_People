import React from 'react';
import { useLocation } from 'react-router-dom';
import { operationsWorkspaceFor } from '../operationsWorkspaces';
import EmpEmployees from './EmpEmployees';
import EmpUserSpecific from './EmpUserSpecific';
import EmpInsights from './EmpInsights';
import EmpOrgList from './EmpOrgList';
import EmpGroups from './EmpGroups';
import EmpDelegation from './EmpDelegation';

/* The Employee Information workspace.
 *
 * The tab strip is NOT drawn here — it lives in the navy bar, rendered by
 * Topbar from operationsWorkspaces.js. This component only decides which panel
 * the active tab shows, so the bar and the page cannot disagree about which
 * tabs exist.
 */

// Departments carries two fields Designations does not, so the shared list
// component takes them as extras rather than branching inside itself.
const DEPARTMENT_EXTRA_COLUMNS = [
  { key: 'headName', label: 'Department Lead',
    render: r => r.headName || <span className="text-slate-300">—</span> },
  { key: 'parentName', label: 'Parent Department',
    render: r => r.parentName || <span className="text-slate-300">—</span> },
];
const DEPARTMENT_EXTRA_FIELDS = [
  { key: 'headName', label: 'Department Lead', type: 'text' },
  { key: 'parentName', label: 'Parent Department', type: 'text' },
];

function DepartmentFields({ form, setForm, input, label }) {
  return (
    <>
      <div>
        <label className={label}>Department Lead</label>
        {/* Free text would create a lead nobody can resolve to a person, so
            this stays an id field until the people picker is shared here. */}
        <input className={input} value={form.headId || ''} placeholder="Employee ID (optional)"
          onChange={e => setForm(f => ({ ...f, headId: e.target.value }))} />
      </div>
      <div>
        <label className={label}>Parent Department</label>
        <input className={input} value={form.parentId || ''} placeholder="Department ID (optional)"
          onChange={e => setForm(f => ({ ...f, parentId: e.target.value }))} />
      </div>
    </>
  );
}

export default function OperationsEmployeeInformation() {
  const location = useLocation();
  const ws = operationsWorkspaceFor(location.pathname, location.search);
  const tab = ws?.activeId || 'employees';

  return (
    <div className="p-5">
      {tab === 'employees' && <EmpEmployees />}
      {tab === 'user' && <EmpUserSpecific />}
      {tab === 'insights' && <EmpInsights />}
      {tab === 'departments' && (
        <EmpOrgList
          resource="departments" title="Departments" singular="Department"
          extraColumns={DEPARTMENT_EXTRA_COLUMNS} extraFields={DEPARTMENT_EXTRA_FIELDS}
          FormFields={DepartmentFields}
        />
      )}
      {tab === 'designations' && (
        <EmpOrgList resource="designations" title="Designations" singular="Designation" />
      )}
      {tab === 'groups' && <EmpGroups />}
      {tab === 'delegation' && <EmpDelegation />}
    </div>
  );
}
