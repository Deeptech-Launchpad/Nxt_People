import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import api from '../../utils/api';

// Holidays configuration — the reminder email template and the classifications
// that name each holiday type. This is not the holiday list: the list of dates
// lives on its own screen under Leave Tracker, and this decides what those
// dates can be classified as.
//
// A classification is more than a label. Holiday type drives whether the office
// is treated as closed, which feeds every working-day count, so renaming one is
// safe but removing one strands the holidays that use it.
const DEFAULT_TEMPLATE = `Hi \${employee.name},

This is a reminder that \${holiday.name} falls on \${holiday.date}.

The office will be closed. Enjoy your day.`;

export default function HolidayConfig() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [inUse, setInUse] = useState({});

  useEffect(() => {
    Promise.all([
      api.get('/holidays/config'),
      api.get('/holidays').catch(() => ({ data: { data: [] } })),
    ])
      .then(([c, h]) => {
        setConfig(c.data.data || {});
        // Counting what each classification is attached to turns "are you
        // sure?" into a statement of what would actually be stranded.
        const counts = {};
        for (const row of (h.data.data || [])) counts[row.type] = (counts[row.type] || 0) + 1;
        setInUse(counts);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load holiday settings'))
      .finally(() => setLoading(false));
  }, []);

  const setList = list => { setConfig(c => ({ ...c, classifications: list })); setDirty(true); };

  const save = () => {
    setSaving(true);
    api.patch('/holidays/config', config)
      .then(r => { setConfig(r.data.data); setDirty(false); setEditingTemplate(false); toast.success('Holiday settings saved'); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save those settings'))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!config) return null;

  const list = config.classifications || [];

  const remove = (index) => {
    const c = list[index];
    const count = inUse[c.key] || 0;
    if (count && !window.confirm(`${count} holiday${count === 1 ? '' : 's'} use “${c.label}”. Removing it leaves them unclassified. Continue?`)) return;
    setList(list.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
        <h2 className="text-[15px] font-semibold text-slate-800">Holiday reminder email template</h2>
        <p className="text-[13.5px] text-slate-500 mt-1.5">Customize email template for upcoming holidays</p>

        {editingTemplate ? (
          <div className="mt-4 space-y-2">
            <textarea
              rows={8}
              value={config.reminderTemplate || ''}
              onChange={e => { setConfig(c => ({ ...c, reminderTemplate: e.target.value })); setDirty(true); }}
              placeholder={DEFAULT_TEMPLATE}
              className="w-full text-[13.5px] font-mono rounded-md border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
            <p className="text-[12.5px] text-slate-400">
              Available placeholders: <code>{'${employee.name}'}</code>, <code>{'${holiday.name}'}</code>, <code>{'${holiday.date}'}</code>
            </p>
          </div>
        ) : (
          <button onClick={() => setEditingTemplate(true)}
            className="mt-4 bg-blue-50 hover:bg-blue-100 text-blue-700 px-4 py-2 rounded text-[14px] font-medium">
            Edit Template
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
        <h2 className="text-[15px] font-semibold text-slate-800">Holiday classifications</h2>
        <p className="text-[13.5px] text-slate-500 mt-1.5">
          Classify holidays to facilitate different pay rates for employees who worked on holidays
        </p>

        <p className="text-[14px] text-slate-700 mt-5 mb-3">Classifications</p>
        <div className="bg-slate-50 rounded-lg p-4 inline-block min-w-[420px]">
          {list.map((c, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5 group">
              <span className="text-[14px] text-slate-700 w-[130px] flex-shrink-0">{c.label}</span>
              <input
                value={c.label}
                onChange={e => setList(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                aria-label={`Classification ${i + 1} name`}
                className="flex-1 text-[14px] rounded-md border border-slate-300 px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
              <button
                onClick={() => remove(i)}
                disabled={list.length === 1}
                title={list.length === 1 ? 'At least one classification is required' : 'Remove'}
                className="text-slate-300 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setList([...list, { key: `custom_${list.length + 1}`, label: '' }])}
            className="mt-3 bg-blue-50 hover:bg-blue-100 text-blue-700 px-4 py-2 rounded text-[14px] font-medium"
          >
            Add Classification
          </button>
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-0 bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex items-center gap-3 shadow-lg">
          <button onClick={save} disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded text-[14px] font-medium">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <span className="text-[13px] text-slate-500">Unsaved changes</span>
        </div>
      )}
    </div>
  );
}
