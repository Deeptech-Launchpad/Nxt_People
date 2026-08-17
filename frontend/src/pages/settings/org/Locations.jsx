import React from 'react';
import RecordList from './RecordList';

// Locations — where people work. Until now this was free text on each employee,
// which is why the two-locations rule was only ever a convention: nothing
// stopped a third spelling appearing. These are now records people are assigned
// to, so the list is the rule.
//
// The time zone column the reference shows is fixed at Asia/Kolkata here and
// not editable: attendance, payroll and cron scheduling all assume it, so a
// per-location zone would be a setting the rest of the system ignores. It is
// still a column, because the reference has one and an admin should be able to
// see what the system is assuming rather than guess.
const COLUMNS = [
  { key: 'name', label: 'Location name' },
  { key: 'mailAlias', label: 'Email' },
  { key: 'address', label: 'Address', render: r => (
      [r.addressLine1, r.addressLine2, r.city, r.state, r.postalCode, r.country]
        .filter(Boolean).join(', ') || null
    ) },
  { key: 'timezone', label: 'Time zone' },
  { key: 'description', label: 'Description' },
];

const FIELDS = [
  { key: 'name', label: 'Location name', required: true, placeholder: 'e.g. Saibaba Colony, Coimbatore' },
  { key: 'mailAlias', label: 'Email' },
  { key: 'description', label: 'Description', type: 'textarea', wide: true, maxLength: 500 },
  { key: 'addressLine1', label: 'Address line 1' },
  { key: 'addressLine2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State / Province' },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'country', label: 'Country', placeholder: 'India' },
  {
    key: 'timezone', label: 'Time zone', readOnly: true, placeholder: 'Asia/Kolkata',
    hint: 'Fixed. Attendance, payroll and the schedulers all assume this zone.',
  },
];

export default function Locations() {
  return (
    <RecordList
      resource="locations"
      title="Locations"
      singular="Location"
      description="The places people work from. An employee is assigned to one of these."
      columns={COLUMNS}
      fields={FIELDS}
      emptyHint="Add the office, and one for anyone working from home."
    />
  );
}
