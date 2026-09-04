import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, ListTodo, Download, Upload, Eye, EyeOff, Image, History, X } from 'lucide-react';
import api from '../../../utils/api';
import DataListView from '../../../components/listview/DataListView';
import ViewPicker from '../../../components/listview/ViewPicker';
import useListView from './useListView';
import ScopeSelect from './ScopeSelect';
import AddUserWizard from './AddUserWizard';
import AddTaskModal from './AddTaskModal';
import PhotoUploadDialog from './PhotoUploadDialog';
import ImportDialog from '../../../components/listview/ImportDialog';
import RevealDialog from '../../../components/listview/RevealDialog';
import downloadFile from '../../../components/listview/downloadFile';
import EmployeeRecordModal from './EmployeeRecordModal';
import EmployeeEditModal from './EmployeeEditModal';
import EmployeeActivity from './EmployeeActivity';
import { EMPLOYEE_INFO_BASE } from '../operationsWorkspaces';

/* Operations -> Employee Information -> Employees.
 *
 * The reference's column set, in its order, with the first three frozen so
 * Employee ID / First Name / Last Name stay put at every horizontal scroll
 * position — otherwise a wide table loses which row you are reading.
 *
 * Aadhaar / PAN / UAN render as dots. The list endpoint returns only whether
 * one is on file, never the value, so "Show masked data" cannot unhide
 * something the browser already had — it asks the server, which writes an
 * audit row naming who looked. Revealed values are held in component state
 * only, so any refetch re-masks them.
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
const masked = (has, value) => {
  if (value) return <span className="text-slate-800 font-mono text-[14px]">{value}</span>;
  return has
    ? <span className="text-slate-400 tracking-widest">•••••••••</span>
    : <span className="text-slate-300">—</span>;
};

/* The eye on a masked column header. Toggles back to hidden once revealed,
 * so a screen left open does not sit there showing identity numbers. */
function MaskEye({ on, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={on ? 'Hide these values' : 'Show these values (recorded in the audit trail)'}
      className={`ml-1.5 w-6 h-6 inline-flex items-center justify-center rounded
        ${on ? 'text-brand-600 hover:bg-brand-50' : 'text-slate-400 hover:bg-slate-200/70 hover:text-slate-600'}`}>
      {on ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  );
}

export default function EmpEmployees() {
  const navigate = useNavigate();
  /* Opens on CURRENTLY EMPLOYED people, which is what the reference's default
   * "Employee View" shows and why its count reads 58 where every row ever
   * created reads 153.
   *
   * BOTH conditions are needed, and which one does the work differs by
   * database. Locally `status` is maintained, so it alone narrows 155 to 68.
   * On live the Zoho migration brought exit dates across but left everybody
   * marked active — so status alone changes nothing there and only the exit
   * date separates leavers. Requiring both is correct on either.
   *
   * They are real, removable criteria rather than a hidden WHERE: the chips
   * above the table say the filter is on, and clearing them shows leavers. */
  const lv = useListView({
    endpoint: '/employees', module: 'employees',
    /* The reference lists newest employee ID first, so the people added most
     * recently are at the top. Ours fell back to created_at, which put a
     * migrated row with the ID "1" in the middle of the first page. */
    defaultSort: { by: 'employeeId', dir: 'desc' },
    initialCriteria: [
      { field: 'status', operator: 'is', value: 'active' },
      { field: 'exitDate', operator: 'is_empty' },
    ],
  });
  const [wizard, setWizard] = useState(false);
  const [taskFor, setTaskFor] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [meta, setMeta] = useState({ departments: [], locations: [] });
  const [importing, setImporting] = useState(false);
  const [photos, setPhotos] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealCol, setRevealCol] = useState(null);   // which masked column asked
  const [viewing, setViewing] = useState(null);       // employee id, full record
  const [editing, setEditing] = useState(null);       // employee id, edit form
  const [activityFor, setActivityFor] = useState(null); // row, activity only
  /* Revealed identity numbers live only in this component's state for as long
   * as the page is open. They are never written back into the row data, so a
   * refetch re-masks them rather than leaving them on screen indefinitely. */
  const [revealed, setRevealed] = useState({});
  const [picked, setPicked] = useState([]);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    api.get('/employees/metadata')
      .then(r => setMeta({
        departments: r.data.data?.departments || [],
        locations: [],
      }))
      .catch(() => {});
  }, []);

  const columns = useMemo(() => [
    { key: 'employeeId', label: 'Employee ID', width: 150 },
    { key: 'firstName', label: 'First Name', width: 150 },
    { key: 'lastName', label: 'Last Name', width: 150 },
    { key: 'nickName', label: 'Nick name', width: 120, render: r => dash(r.nickName) },
    { key: 'email', label: 'Email address', width: 250 },
    { key: 'photo', label: 'Photo', sortable: false, width: 80, render: r => (
        r.photoUrl
          ? <img src={r.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
          : <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <Image size={14} />
            </span>
      ) },
    { key: 'department', label: 'Department', width: 180, render: r => dash(r.department) },
    { key: 'designation', label: 'Designation', width: 230, render: r => dash(r.designation) },
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
    { key: 'reportingManager', label: 'Reporting Manager', width: 210, render: r =>
        dash(r.manager?.firstName ? `${r.manager.firstName} ${r.manager.lastName || ''}`.trim() : '') },
    { key: 'dateOfBirth', label: 'Date of Birth', render: r => dash(fmtDate(r.dateOfBirth)) },
    { key: 'gender', label: 'Gender', render: r => <span className="capitalize">{dash(r.gender)}</span> },
    { key: 'maritalStatus', label: 'Marital Status', render: r => <span className="capitalize">{dash(r.maritalStatus)}</span> },
    { key: 'aboutMe', label: 'About Me', width: 220, render: r => dash(r.aboutMe) },
    { key: 'expertise', label: 'Ask me about/Expertise', width: 210, render: r => dash(r.expertise) },
    { key: 'workPhone', label: 'Work Phone Number', render: r => dash(r.workPhone) },
    { key: 'extension', label: 'Extension', render: r => dash(r.extension) },
    { key: 'workLocation', label: 'Location', render: r => dash(r.workLocation) },
    { key: 'phone', label: 'Personal Mobile Number', render: r => dash(r.phone) },
    { key: 'personalEmail', label: 'Personal Email Address', width: 230, render: r => dash(r.personalEmail) },
    { key: 'exitDate', label: 'Date of Exit', render: r => dash(fmtDate(r.exitDate)) },
    { key: 'addedTime', label: 'Added Time', render: r => dash(fmtDateTime(r.addedTime)) },
    { key: 'modifiedTime', label: 'Modified Time', render: r => dash(fmtDateTime(r.modifiedTime)) },
    { key: 'presentAddress', label: 'Present Address', width: 260, render: r => dash(r.presentAddress) },
    { key: 'permanentAddress', label: 'Permanent Address', width: 260, render: r => dash(r.permanentAddress) },
    /* The reference puts an eye in the HEADER of each masked column, so you
     * reveal one column rather than hunting through a menu. It still goes
     * through the same audited request — the values are not in the browser
     * until the server is asked for them. */
    { key: 'aadhaar', label: 'Aadhaar', sortable: false, width: 150,
      headerAction: <MaskEye on={!!Object.keys(revealed).length} onClick={() => askReveal('aadhaar')} />,
      render: r => masked(r.hasAadhaar, revealed[r._id]?.aadhaarNumber) },
    { key: 'pan', label: 'PAN', sortable: false, width: 140,
      headerAction: <MaskEye on={!!Object.keys(revealed).length} onClick={() => askReveal('pan')} />,
      render: r => masked(r.hasPan, revealed[r._id]?.panNumber) },
    { key: 'uan', label: 'UAN', sortable: false, width: 150,
      headerAction: <MaskEye on={!!Object.keys(revealed).length} onClick={() => askReveal('uan')} />,
      render: r => masked(r.hasUan, revealed[r._id]?.uanNumber) },
  ], [revealed, lv.rows]);

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

  /* Bulk archive. Deliberately N calls to the SAME endpoint the single delete
   * uses: the soft-delete and its guards are already proved there, and a
   * second implementation is what drifts. Failures are counted, not swallowed. */
  const removeMany = async () => {
    setBulkBusy(true);
    const targets = lv.rows.filter(r => picked.includes(r._id));
    let ok = 0; const failed = [];
    for (const r of targets) {
      try { await api.delete(`/employees/${r._id}`); ok++; }
      catch (err) { failed.push(`${r.employeeId}: ${err.response?.data?.message || 'failed'}`); }
    }
    setBulkBusy(false); setBulkDelete(false); setPicked([]); lv.reload();
    if (ok) toast.success(`${ok} employee(s) archived`);
    if (failed.length) toast.error(`${failed.length} could not be archived - ${failed[0]}`, { duration: 6000 });
  };

  /* One dialog serves all three columns: the reveal returns Aadhaar, PAN and
   * UAN together because they come from one row, and asking three times would
   * mean three audit entries for one glance. */
  const askReveal = (col) => {
    if (Object.keys(revealed).length) { setRevealed({}); return; }
    if (!lv.rows.length) return toast.error('Nothing on this page to reveal');
    setRevealCol(col);
    setRevealing(true);
  };

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
        selectable selected={picked} onSelected={setPicked}
        bulkActions={[
          { label: `Archive ${picked.length}`, danger: true, onClick: () => setBulkDelete(true) },
        ]}
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
          { label: 'Import', icon: <Upload size={15} />, onClick: () => setImporting(true) },
          // The export carries the criteria that are on screen, so the file
          // agrees with the table somebody was looking at when they asked.
          { label: 'Export', icon: <Download size={15} />, onClick: () => downloadFile(
              `/employee-io/export/employees${lv.criteria.length
                ? `?criteria=${encodeURIComponent(JSON.stringify(lv.criteria))}` : ''}`,
              `employees-${new Date().toISOString().slice(0, 10)}.xlsx`) },
          { label: 'History Export', icon: <Download size={15} />, onClick: () => downloadFile(
              '/employee-io/history-export/employees',
              `employees-history-${new Date().toISOString().slice(0, 10)}.xlsx`) },
          { label: 'Profile Photo Upload', icon: <Image size={15} />, onClick: () => setPhotos(true) },
          Object.keys(revealed).length
            ? { label: 'Hide masked data', icon: <EyeOff size={15} />, onClick: () => setRevealed({}) }
            : { label: 'Show masked data', icon: <Eye size={15} />,
                onClick: () => (lv.rows.length
                  ? setRevealing(true)
                  : toast.error('Nothing on this page to reveal')) },
        ]}
        rowMenu={(r) => [
          { label: 'View', icon: <Eye size={15} />, onClick: () => setViewing(r._id) },
          /* Its own entry because it was the bottom of a long record, and
           * "when did they send that document" is a question people ask far
           * more often than they read a whole profile. */
          { label: 'Activity', icon: <History size={15} />, onClick: () => setActivityFor(r) },
          { label: 'Edit', icon: <Pencil size={15} />, onClick: () => setEditing(r._id) },
          { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onClick: () => setToDelete(r) },
          { label: 'Add New Task', icon: <ListTodo size={15} />, onClick: () => setTaskFor(r) },
        ]}
        /* Opens the record over the list. It used to navigate to User-specific
         * Operations, which threw away where you were just to read a row. */
        onRowClick={(r) => setViewing(r._id)}
      />

      {viewing && (
        <EmployeeRecordModal
          employeeId={viewing}
          onClose={() => setViewing(null)}
          onEdit={(id) => { setViewing(null); setEditing(id); }}
          onChanged={() => lv.reload()}
        />
      )}
      {editing && (
        <EmployeeEditModal
          employeeId={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); lv.reload(); }}
        />
      )}

      {wizard && <AddUserWizard onClose={() => setWizard(false)} onCreated={() => { setWizard(false); lv.reload(); }} />}
      {importing && (
        <ImportDialog module="employees" title="Employees"
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); lv.reload(); }} />
      )}
      {photos && (
        <PhotoUploadDialog onClose={() => setPhotos(false)} onDone={() => lv.reload()} />
      )}
      {revealing && (
        <RevealDialog employeeIds={lv.rows.map(r => r._id)}
          onClose={() => setRevealing(false)}
          onRevealed={(rows) => setRevealed(Object.fromEntries(rows.map(x => [x._id, x])))} />
      )}
      {activityFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setActivityFor(null)}>
          <div className="bg-slate-50 rounded-2xl w-full max-w-2xl shadow-2xl my-4 flex flex-col max-h-[94vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 bg-white rounded-t-2xl border-b border-slate-100">
              <span className="text-[17px] font-semibold text-slate-800 truncate">
                {`${activityFor.employeeId} - ${activityFor.firstName} ${activityFor.lastName || ''}`.trim()}
              </span>
              <button onClick={() => setActivityFor(null)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 flex-shrink-0">
                <X size={19} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <EmployeeActivity employeeId={activityFor._id} />
            </div>
          </div>
        </div>
      )}

      {taskFor && <AddTaskModal employee={taskFor} onClose={() => setTaskFor(null)} />}

      {bulkDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h3 className="font-display font-semibold text-slate-800 text-xl">
              Archive {picked.length} employee(s)?
            </h3>
            <p className="text-[14px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 mt-3">
              They are archived, not erased - attendance, leave and payslip history stays intact and
              they can no longer sign in. This cannot be undone from here.
            </p>
            <div className="max-h-40 overflow-y-auto mt-3 border border-slate-100 rounded-xl divide-y divide-slate-50">
              {lv.rows.filter(r => picked.includes(r._id)).map(r => (
                <div key={r._id} className="px-3 py-2 text-[14px] text-slate-600 flex justify-between gap-3">
                  <span className="truncate">{r.firstName} {r.lastName}</span>
                  <span className="text-slate-400 flex-shrink-0">{r.employeeId}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setBulkDelete(false)} disabled={bulkBusy}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={removeMany} disabled={bulkBusy}
                className="flex-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white py-2.5 rounded-xl text-[15px] font-medium">
                {bulkBusy ? 'Archiving...' : `Archive ${picked.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

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
