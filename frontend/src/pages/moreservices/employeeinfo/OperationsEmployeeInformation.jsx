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
  { key: 'headName', label: 'Department Lead', width: 230,
    render: r => r.headName || <span className="text-slate-300">—</span> },
  { key: 'parentName', label: 'Parent Department', width: 210,
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

  /* The page is exactly the viewport minus the navy bar (48px) and the fixed
   * bottom bar (30px). A height rather than a min-height, because the list
   * tabs size their table off it — with `p-5` alone the table fell back to a
   * guessed max-height and left a band of dead space above the footer.
   *
   * Tabs that scroll their own content (Insights, the profile) get the scroll;
   * the list tabs pass the height down to the table instead. */
  const scrolls = tab === 'insights' || tab === 'user' || tab === 'groups' || tab === 'delegation';

  return (
    <div className="h-[calc(100vh-78px)] flex flex-col min-h-0 p-5">
      <div className={`flex-1 min-h-0 flex flex-col ${scrolls ? 'overflow-y-auto' : ''}`}>
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
    </div>
  );
}
