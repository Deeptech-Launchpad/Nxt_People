import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { Card, Toggle, Spinner, SaveBar } from '../configKit';
import { DEFAULT_LABELS, useStructure } from './structureLabels';

// Organization Structure → Configuration.
//
// Two things live here: whether the structure is used at all, and what the
// three levels are called. Both are in one settings blob and save together —
// unlike Organization Policy, the reference has a single Save on this screen.
//
// It ships off. Turning it on is what makes a business unit and a division
// worth assigning; an organization with one legal entity and nothing under it
// does not need three more fields on every employee record.
const ROWS = [
  {
    key: 'legalEntity',
    hint: 'Independently operated companies under one parent organization.',
  },
  {
    key: 'businessUnit',
    hint: 'Operational units inside the organization. A business unit belongs to one company.',
  },
  {
    key: 'division',
    hint: 'Functional units. A division sits under a business unit, or under another division, and departments can be tagged to one.',
  },
];

const input = 'w-full max-w-sm border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

export default function StructureConfiguration() {
  const { loading, enabled, labels, reload } = useStructure();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading) setDraft({ enabled, labels: { ...labels } });
  }, [loading, enabled, labels]);

  if (loading || !draft) return <Spinner />;

  const dirty = draft.enabled !== enabled
    || ROWS.some(r => (draft.labels[r.key] || '') !== (labels[r.key] || ''));

  const save = () => {
    setSaving(true);
    api.patch('/org-details/structure', draft)
      .then(() => { toast.success('Organization structure saved'); reload(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-4 pb-24">
      <Card
        title="Organization Structure"
        description="Three levels above departments: legal entities, the operational units inside them, and the functional units inside those."
      >
        <Toggle
          checked={draft.enabled}
          onChange={v => setDraft(d => ({ ...d, enabled: v }))}
          label="Use organization structure"
          hint="While this is off the levels can still be set up here, but employees are not assigned to them and the structure does not appear on a profile."
        />
      </Card>

      <Card
        title="Component names"
        description="What this organization calls each level. The rail, the headings and the buttons follow these."
      >
        <div className="space-y-5">
          {ROWS.map(r => (
            <div key={r.key}>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                {DEFAULT_LABELS[r.key]}
              </label>
              <input
                value={draft.labels[r.key] ?? ''}
                maxLength={60}
                placeholder={DEFAULT_LABELS[r.key]}
                onChange={e => setDraft(d => ({ ...d, labels: { ...d.labels, [r.key]: e.target.value } }))}
                className={input}
              />
              <p className="text-[12.5px] text-slate-500 mt-1">{r.hint}</p>
            </div>
          ))}
          {/* Left blank, the server puts the built-in name back rather than
              leaving a rail item and a heading with no word in them. */}
          <p className="text-[12.5px] text-slate-500">
            Leave a name empty to go back to the built-in one.
          </p>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
