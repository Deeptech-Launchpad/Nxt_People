import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, ListTodo, Download, Upload, Eye, EyeOff, Image } from 'lucide-react';
import api from '../../../utils/api';
import DataListView from '../../../components/listview/DataListView';
import ViewPicker from '../../../components/listview/ViewPicker';
import useListView from './useListView';
import ScopeSelect from './ScopeSelect';
import AddUserWizard from './AddUserWizard';
import AddTaskModal from './AddTaskModal';
import { EMPLOYEE_INFO_BASE } from '../operationsWorkspaces';

/* Operations -> Employee Information -> Employees.
 *
 * The reference's column set, in its order, with the first three frozen so
 * Employee ID / First Name / Last Name stay put at every horizontal scroll
 * position — otherwise a wide table loses which row you are reading.
 *
 * Aadhaar / PAN / UAN render as dots. The list endpoint returns only whether
 * one is on file, never the value, so "Show masked data" cannot reveal them
 * from data already in the browser — it is a per-person, audited request, and
 * until that is built the menu item says so rather than doing nothing.
 */
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-GB');
};
const fmtDateTime = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};
const dash = (v) => (v === null || v === undefined || v === '' ? <span className="text-slate-300">—</span> : v);
const masked = (has) => has
  ? <span className="text-slate-400 tracking-widest">•••••••••</span>
  : <span className="text-slate-300">—</span>;

export default function EmpEmployees() {
  const navigate = useNavigate();
  const lv = useListView({ endpoint: '/employees', module: 'employees', defaultSort: { by: '', dir: 'desc' } });
  const [wizard, setWizard] = useState(false);
  const [taskFor, setTaskFor] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [meta, setMeta] = useState({ departments: [], locations: [] });

  useEffect(() => {
    api.get('/employees/metadata')
      .then(r => setMeta({
        departments: r.data.data?.departments || [],
        locations: [],
      }))
      .catch(() => {});
  }, []);

  const columns = useMemo(() => [
    { key: 'employeeId', label: 'Employee ID' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'nickName', label: 'Nick name', render: r => dash(r.nickName) },
    { key: 'email', label: 'Email address' },
    { key: 'photo', label: 'Photo', sortable: false, render: r => (
        r.photoUrl
          ? <img src={r.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
          : <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <Image size={14} />
            </span>
      ) },
    { key: 'department', label: 'Department', render: r => dash(r.department) },
    { key: 'designation', label: 'Designation', render: r => dash(r.designation) },
    { key: 'role', label: 'Role', render: r => <span className="capitalize">{String(r.role || '').replace(/_/g, ' ')}</span> },
    { key: 'employmentType', label: 'Employment Type', render: r => dash(r.employmentType) },
    { key: 'status', label: 'Employee Status', render: r => (
        <span className={`text-[13px] px-2 py-0.5 rounded-full capitalize font-medium ${
          r.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {r.status}
        </span>
      ) },
    { key: 'sourceOfHire', label: 'Source of Hire', render: r => dash(r.sourceOfHire) },
    { key: 'joiningDate', label: 'Date of Joining', render: r => dash(fmtDate(r.dateOfJoining || r.joiningDate)) },
    { key: 'totalExperience', label: 'Total Experience', render: r => dash(r.totalExperience) },
    { key: 'reportingManager', label: 'Reporting Manager', render: r =>
        dash(r.manager?.firstName ? `${r.manager.firstName} ${r.manager.lastName || ''}`.trim() : '') },
    { key: 'dateOfBirth', label: 'Date of Birth', render: r => dash(fmtDate(r.dateOfBirth)) },
    { key: 'gender', label: 'Gender', render: r => <span className="capitalize">{dash(r.gender)}</span> },
    { key: 'maritalStatus', label: 'Marital Status', render: r => <span className="capitalize">{dash(r.maritalStatus)}</span> },
    { key: 'aboutMe', label: 'About Me', render: r => dash(r.aboutMe) },
    { key: 'expertise', label: 'Ask me about/Expertise', render: r => dash(r.expertise) },
    { key: 'workPhone', label: 'Work Phone Number', render: r => dash(r.workPhone) },
    { key: 'extension', label: 'Extension', render: r => dash(r.extension) },
    { key: 'workLocation', label: 'Location', render: r => dash(r.workLocation) },
    { key: 'phone', label: 'Personal Mobile Number', render: r => dash(r.phone) },
    { key: 'personalEmail', label: 'Personal Email Address', render: r => dash(r.personalEmail) },
    { key: 'exitDate', label: 'Date of Exit', render: r => dash(fmtDate(r.exitDate)) },
    { key: 'addedTime', label: 'Added Time', render: r => dash(fmtDateTime(r.addedTime)) },
    { key: 'modifiedTime', label: 'Modified Time', render: r => dash(fmtDateTime(r.modifiedTime)) },
    { key: 'presentAddress', label: 'Present Address', render: r => dash(r.presentAddress) },
    { key: 'permanentAddress', label: 'Permanent Address', render: r => dash(r.permanentAddress) },
    { key: 'aadhaar', label: 'Aadhaar', sortable: false, render: r => masked(r.hasAadhaar) },
    { key: 'pan', label: 'PAN', sortable: false, render: r => masked(r.hasPan) },
    { key: 'uan', label: 'UAN', sortable: false, render: r => masked(r.hasUan) },
  ], []);

  // The filter offers only what the server will actually honour; anything else
  // would be accepted and quietly ignored.
  const fields = useMemo(() => [
    { key: 'employeeId', label: 'Employee ID', type: 'text' },
    { key: 'firstName', label: 'First Name', type: 'text' },
    { key: 'lastName', label: 'Last Name', type: 'text' },
    { key: 'nickName', label: 'Nick name', type: 'text' },
    { key: 'email', label: 'Email address', type: 'text' },
    { key: 'department', label: 'Department', type: 'text' },
    { key: 'designation', label: 'Designation', type: 'text' },
    { key: 'role', label: 'Role', type: 'text' },
    { key: 'employmentType', label: 'Employment Type', type: 'text' },
    { key: 'status', label: 'Employee Status', type: 'text' },
    { key: 'sourceOfHire', label: 'Source of Hire', type: 'text' },
    { key: 'joiningDate', label: 'Date of Joining', type: 'date' },
    { key: 'totalExperience', label: 'Total Experience', type: 'text' },
    { key: 'reportingManager', label: 'Reporting Manager', type: 'text' },
    { key: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
    { key: 'gender', label: 'Gender', type: 'text' },
    { key: 'maritalStatus', label: 'Marital Status', type: 'text' },
    { key: 'aboutMe', label: 'About Me', type: 'text' },
    { key: 'expertise', label: 'Ask me about/Expertise', type: 'text' },
    { key: 'workPhone', label: 'Work Phone Number', type: 'text' },
    { key: 'extension', label: 'Extension', type: 'text' },
    { key: 'workLocation', label: 'Location', type: 'text' },
    { key: 'personalEmail', label: 'Personal Email Address', type: 'text' },
    { key: 'phone', label: 'Personal Mobile Number', type: 'text' },
    { key: 'exitDate', label: 'Date of Exit', type: 'date' },
    { key: 'addedTime', label: 'Added Time', type: 'datetime' },
    { key: 'modifiedTime', label: 'Modified Time', type: 'datetime' },
    { key: 'presentAddress', label: 'Present Address', type: 'text' },
    { key: 'permanentAddress', label: 'Permanent Address', type: 'text' },
  ], []);

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`/employees/${toDelete._id}`);
      toast.success(`${toDelete.firstName} ${toDelete.lastName || ''} archived`);
      setToDelete(null); lv.reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete that employee');
    } finally { setDeleting(false); }
  };

  return (
    <>
      <DataListView
        columns={columns} fields={fields}
        rows={lv.rows} total={lv.total} loading={lv.loading}
        page={lv.page} limit={lv.limit} onPage={lv.setPage} onLimit={lv.setLimit}
        sort={lv.sort} onSort={lv.onSort}
        criteria={lv.criteria} onCriteria={lv.onCriteria}
        hidden={lv.hidden} onHidden={lv.onHidden}
        frozenCount={3}
        systemFilters={{
          value: lv.system,
          fields: [
            { name: 'search', label: 'Employee', placeholder: 'Name or employee ID' },
            { name: 'department', label: 'Department', placeholder: 'All Department',
              options: meta.departments.map(d => ({ value: d, label: d })) },
          ],
        }}
        toolbarLeft={
          <ViewPicker
            module="employees" fields={fields} active={lv.view}
            defaultLabel="Employee View"
            onSelect={v => lv.onView(v, columns.map(c => c.key))}
          />
        }
        toolbarRight={
          <>
            <ScopeSelect value={lv.scope} onChange={lv.onScope} />
            <button onClick={() => setWizard(true)}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 h-10 rounded-lg text-[15px] font-medium">
              <Plus size={16} /> Add Employee(s)
            </button>
          </>
        }
        toolbarMenu={[
          { label: 'Import', icon: <Upload size={15} />, disabled: 'Not built yet' },
          { label: 'Export', icon: <Download size={15} />,
            onClick: () => toast('Export uses the filters you have applied', { icon: '⬇️' }) },
          { label: 'History Export', icon: <Download size={15} />, disabled: 'Not built yet' },
          { label: 'Profile Photo Upload', icon: <Image size={15} />, disabled: 'Not built yet' },
          { label: 'Show masked data', icon: <EyeOff size={15} />,
            disabled: 'Not built yet — identity numbers are never sent to the browser in a list' },
        ]}
        rowMenu={(r) => [
          { label: 'Edit', icon: <Pencil size={15} />,
            onClick: () => navigate(`${EMPLOYEE_INFO_BASE}?tab=user&employeeId=${r._id}`) },
          { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onClick: () => setToDelete(r) },
          { label: 'Add New Task', icon: <ListTodo size={15} />, onClick: () => setTaskFor(r) },
        ]}
        onRowClick={(r) => navigate(`${EMPLOYEE_INFO_BASE}?tab=user&employeeId=${r._id}`)}
      />

      {wizard && <AddUserWizard onClose={() => setWizard(false)} onCreated={() => { setWizard(false); lv.reload(); }} />}
      {taskFor && <AddTaskModal employee={taskFor} onClose={() => setTaskFor(null)} />}

      {toDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h3 className="font-display font-semibold text-slate-800 text-xl">Delete this employee?</h3>
            <p className="text-slate-500 text-[15px] mt-2">
              {toDelete.firstName} {toDelete.lastName} · {toDelete.employeeId}
            </p>
            {/* Say what actually happens: the record is archived, not purged,
                because attendance, leave and payslips reference it. */}
            <p className="text-[14px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 mt-3">
              They are archived, not erased — their attendance, leave and payslip history stays intact
              and they disappear from lists. They can no longer sign in.
            </p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setToDelete(null)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={remove} disabled={deleting}
                className="flex-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white py-2.5 rounded-xl text-[15px] font-medium">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
