import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../utils/api';
import RecordList from './RecordList';
import { useStructure } from './structureLabels';
import { Spinner } from '../configKit';

// Division — the functional units. These nest, so a division has both a
// business unit and, optionally, a parent division; the server refuses a parent
// that would make a division its own ancestor, and the picker never offers the
// division itself.
export default function Divisions() {
  const { loading, labels } = useStructure();
  const [units, setUnits] = useState([]);

  const loadUnits = useCallback(() => (
    api.get('/org-setup/business_units')
      .then(r => setUnits(r.data.data || []))
      .catch(() => {})
  ), []);

  useEffect(() => { loadUnits(); }, [loadUnits]);

  const columns = useMemo(() => [
    { key: 'name', label: 'Name' },
    { key: 'businessUnitName', label: labels.businessUnit },
    { key: 'parentName', label: `Parent ${labels.division}` },
    { key: 'description', label: 'Description' },
  ], [labels]);

  const fields = useMemo(() => [
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description', type: 'textarea', maxLength: 100 },
    {
      key: 'businessUnitId', label: labels.businessUnit, type: 'search-select',
      placeholder: `No ${labels.businessUnit.toLowerCase()}`,
      quickAdd: 'business_units',
      options: () => units.map(u => ({ value: u.id, label: u.name })),
    },
    {
      key: 'parentId', label: `Parent ${labels.division}`, type: 'search-select',
      placeholder: 'None',
      hint: `Leave blank for a top-level ${labels.division.toLowerCase()}.`,
      selfExcluding: true,
      quickAdd: 'divisions',
      options: rows => rows.map(r => ({ value: r.id, label: r.name })),
    },
  ], [labels, units]);

  if (loading) return <Spinner />;

  return (
    <RecordList
      resource="divisions"
      title={labels.division}
      singular={labels.division}
      description={`Functional units inside a ${labels.businessUnit.toLowerCase()}. Departments can be tagged to one.`}
      columns={columns}
      fields={fields}
      variant="panel"
      onExternalAdd={loadUnits}
    />
  );
}
