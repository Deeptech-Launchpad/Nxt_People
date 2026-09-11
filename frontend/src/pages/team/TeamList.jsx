import React, { useMemo, useState } from 'react';
import DataListView from '../../components/listview/DataListView';
import useListView from '../moreservices/employeeinfo/useListView';
import { Avatar, DirectScopeNote, fmtDay } from './teamShared';

/* ── Team List ────────────────────────────────────────────────────────────
 *  The roster as a table. /employees is full-access only, so an approver has
 *  never had one — they have had the org chart and a card grid, neither of
 *  which can be sorted or filtered.
 *
 *  Nothing here draws a table: DataListView is the table, useListView is the
 *  paging/sort/criteria plumbing, and this file is the column set plus the
 *  filter registry. Both are the same pair Employee Information's three list
 *  tabs use, so a fix to the sort behaviour lands here too.
 *
 *  Column preferences stay in component state rather than going through
 *  /saved-views/column-prefs, whose module allow-list does not name this
 *  screen — a picker whose Save silently 400s is worse than one that forgets.
 * ────────────────────────────────────────────────────────────────────────── */

export default function TeamList({ embedded = false }) {
  const lv = useListView({ endpoint: '/team/list', defaultSort: { by: 'firstName', dir: 'asc' } });
  const [hidden, setHidden] = useState([]);

  /* Mirrors TEAM_LIST_FIELDS in routes/team.js. A key the server does not
   * know is dropped there rather than guessed, so a drift shows up as a
   * filter that does nothing — keep the two in step. */
  const fields = useMemo(() => [
    { key: 'employeeId',     label: 'Employee ID',     type: 'text' },
    { key: 'firstName',      label: 'First Name',      type: 'text' },
    { key: 'lastName',       label: 'Last Name',       type: 'text' },
    { key: 'email',          label: 'Email',           type: 'text' },
    { key: 'designation',    label: 'Designation',     type: 'text' },
    { key: 'department',     label: 'Department',      type: 'text' },
    { key: 'workLocation',   label: 'Work Location',   type: 'text' },
    { key: 'employmentType', label: 'Employment Type', type: 'text' },
    { key: 'shiftName',      label: 'Shift',           type: 'text' },
    { key: 'phone',          label: 'Mobile',          type: 'text' },
    { key: 'joined',         label: 'Date of Joining', type: 'date' },
  ], []);

  const columns = useMemo(() => [
    { key: 'employeeId', label: 'Employee ID', width: 150,
      render: r => (
        <span className="flex items-center gap-2">
          <Avatar person={r} size={24} />
          <span className="font-mono text-[13px] text-slate-500">{r.employeeId || '—'}</span>
        </span>
      ) },
    // Sorting "Name" would have to pick one of the two columns it renders, so
    // the sortable pair stays First Name / Last Name in the filter registry.
    { key: 'name', label: 'Name', width: 200, sortable: false,
      render: r => <span className="font-medium text-slate-800">{r.firstName} {r.lastName}</span> },
    { key: 'email', label: 'Email', width: 230 },
    { key: 'designation', label: 'Designation', width: 190 },
    { key: 'department', label: 'Department', width: 170 },
    { key: 'workLocation', label: 'Work Location', width: 160 },
    { key: 'shiftName', label: 'Shift', width: 160 },
    { key: 'employmentType', label: 'Employment Type', width: 170 },
    { key: 'reportingManager', label: 'Reporting Manager', width: 190, sortable: false },
    { key: 'phone', label: 'Mobile', width: 140 },
    { key: 'joined', label: 'Date of Joining', width: 150, render: r => fmtDay(r.joined) },
  ], []);

  return (
    <div className={`${embedded ? 'p-5' : 'p-6'} flex flex-col min-h-[calc(100vh-13rem)]`}>
      <DataListView
        columns={columns}
        rows={lv.rows} total={lv.total} loading={lv.loading}
        page={lv.page} limit={lv.limit} onPage={lv.setPage} onLimit={lv.setLimit}
        sort={lv.sort} onSort={lv.onSort}
        fields={fields} criteria={lv.criteria} onCriteria={lv.onCriteria}
        hidden={hidden} onHidden={setHidden}
        frozenCount={2}
        emptyText="Nobody reports to you yet"
        toolbarLeft={<DirectScopeNote />}
      />
    </div>
  );
}
