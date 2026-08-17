import React from 'react';
import RecordList from './RecordList';

// Companies — the legal entity people are employed by.
//
// The table has existed since the first schema with one row and nothing
// referencing it, while every employee carried the name as free text. That is
// the same drift that gave six work locations to an org with two, and it is why
// this is worth having now rather than when a second entity appears: the link
// is what lets a report say "employees of company X".
//
// Business Unit and Division, the two levels the reference puts below this, are
// not built. They would be a third and fourth level for an organization that
// has one of each.
const COLUMNS = [
  { key: 'name', label: 'Company name' },
  { key: 'code', label: 'Code' },
  { key: 'description', label: 'Description' },
];

const FIELDS = [
  { key: 'name', label: 'Company name', required: true },
  { key: 'code', label: 'Code', hint: 'A short identifier, e.g. NXT.' },
  { key: 'description', label: 'Description', type: 'textarea' },
];

export default function Companies() {
  return (
    <RecordList
      resource="companies"
      title="Companies"
      singular="Company"
      description="The legal entities in this organization. An employee belongs to one."
      columns={COLUMNS}
      fields={FIELDS}
    />
  );
}
