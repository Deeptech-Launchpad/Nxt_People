import React from 'react';
import RecordList from './RecordList';

// Designations — job titles. Previously free text, so the same title existed
// under several spellings and no report could group by it reliably.
const COLUMNS = [
  { key: 'name', label: 'Designation name' },
  { key: 'mailAlias', label: 'Email' },
];

const FIELDS = [
  { key: 'name', label: 'Designation name', required: true },
  { key: 'mailAlias', label: 'Email' },
];

export default function Designations() {
  return (
    <RecordList
      resource="designations"
      title="Designations"
      singular="Designation"
      description="Job titles employees can be given."
      columns={COLUMNS}
      fields={FIELDS}
    />
  );
}
