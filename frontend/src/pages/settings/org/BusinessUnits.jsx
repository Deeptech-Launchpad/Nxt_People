import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../utils/api';
import RecordList from './RecordList';
import { useStructure } from './structureLabels';
import { Spinner } from '../configKit';

// Business Unit — the operational units inside a legal entity.
//
// The parent here is a company rather than another business unit: business
// units do not nest in the reference, only divisions do.
export default function BusinessUnits() {
  const { loading, labels } = useStructure();
  const [companies, setCompanies] = useState([]);

  const loadCompanies = useCallback(() => (
    api.get('/org-setup/companies')
      .then(r => setCompanies(r.data.data || []))
      .catch(() => {})
  ), []);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);

  const columns = useMemo(() => [
    { key: 'name', label: 'Name' },
    { key: 'companyName', label: labels.legalEntity },
    { key: 'description', label: 'Description' },
  ], [labels]);

  const fields = useMemo(() => [
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description', type: 'textarea', maxLength: 100 },
    {
      key: 'companyId', label: labels.legalEntity, type: 'search-select',
      placeholder: `No ${labels.legalEntity.toLowerCase()}`,
      quickAdd: 'companies',
      options: () => companies.map(c => ({ value: c.id, label: c.name })),
    },
  ], [labels, companies]);

  if (loading) return <Spinner />;

  return (
    <RecordList
      resource="business_units"
      title={labels.businessUnit}
      singular={labels.businessUnit}
      description={`Operational units inside a ${labels.legalEntity.toLowerCase()}.`}
      columns={columns}
      fields={fields}
      variant="panel"
      onExternalAdd={loadCompanies}
    />
  );
}
