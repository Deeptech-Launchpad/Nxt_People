import React from 'react';
import RecordList from './RecordList';
import { useStructure } from './structureLabels';
import { Spinner } from '../configKit';

// The legal entity people are employed by — the top level of the organization
// structure, below the organization itself.
//
// The table has existed since the first schema with one row and nothing
// referencing it, while every employee carried the name as free text. That is
// the same drift that gave six work locations to an org with two, and it is why
// the link is worth having now rather than when a second entity appears: the
// link is what lets a report say "employees of company X".
const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'code', label: 'Code' },
  { key: 'description', label: 'Description' },
];

const FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'code', label: 'Code', hint: 'A short identifier, e.g. NXT.' },
  { key: 'description', label: 'Description', type: 'textarea', maxLength: 100 },
];

export default function Companies() {
  const { loading, labels } = useStructure();
  if (loading) return <Spinner />;

  return (
    <RecordList
      resource="companies"
      title={labels.legalEntity}
      singular={labels.legalEntity}
      description="The legal entities in this organization. An employee belongs to one."
      columns={COLUMNS}
      fields={FIELDS}
      variant="panel"
    />
  );
}
