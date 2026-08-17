import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../utils/api';
import RecordList from './RecordList';

// Departments — the table already existed with a lead and a parent, and had
// never been written to; employees carried a department name as free text
// instead. Both are now filled and linked.
//
// Department Lead needs the employee list, so it is loaded here and folded into
// the field definition rather than RecordList knowing about employees. The
// picker shows the employee id beside the name, as the reference does: two
// people can share a name and the id is the only thing that separates them.
const COLUMNS = [
  { key: 'name', label: 'Department name' },
  { key: 'headName', label: 'Department lead' },
  { key: 'parentName', label: 'Parent department' },
  { key: 'mailAlias', label: 'Email' },
];

export default function Departments() {
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api.get('/employees?limit=500')
      .then(r => {
        if (cancelled) return;
        const list = r.data?.data || r.data?.employees || [];
        setEmployees(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const fields = useMemo(() => [
    { key: 'name', label: 'Department name', required: true },
    { key: 'mailAlias', label: 'Email' },
    {
      key: 'headId', label: 'Department lead', type: 'search-select',
      placeholder: 'No lead',
      options: () => employees
        .map(e => ({
          value: e._id || e.id,
          label: `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email,
          sub: e.employeeId || '',
        }))
        .filter(o => o.value && o.label)
        .sort((a, b) => a.label.localeCompare(b.label)),
    },
    {
      key: 'parentId', label: 'Parent department', type: 'search-select',
      placeholder: 'None',
      hint: 'Leave blank for a top-level department.',
      selfExcluding: true,
      // The + creates a department without leaving this form, and selects it.
      quickAdd: 'departments',
      // Fed the department list RecordList already has, so the picker cannot
      // offer a department that was deleted a moment ago.
      options: rows => rows.map(r => ({ value: r.id, label: r.name })),
    },
  ], [employees]);

  return (
    <RecordList
      resource="departments"
      title="Departments"
      singular="Department"
      description="The organization's departments, their leads, and how they nest."
      columns={COLUMNS}
      fields={fields}
    />
  );
}
