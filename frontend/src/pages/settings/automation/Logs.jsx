import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';
import { useCatalog, LogTimeline } from './kit';

// The two log screens. A workflow you cannot see having run is a workflow
// nobody trusts, which is why "the criteria did not match" is a logged outcome
// here rather than silence.

const time = v => new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function useLogs(path) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => (
    api.get(path)
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setRows([]); })
  ), [path]);
  useEffect(() => { load(); }, [load]);
  return { rows, reload: load };
}

function Header({ title, hint, onRefresh }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
        <p className="text-[13.5px] text-slate-500 mt-1">{hint}</p>
      </div>
      <button onClick={onRefresh}
        className="flex items-center gap-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 px-3.5 py-2 rounded text-[13.5px]">
        <RefreshCw size={14} /> Refresh
      </button>
    </div>
  );
}

export function WorkflowLogs() {
  const catalog = useCatalog();
  const { rows, reload } = useLogs('/workflows/logs');
  if (!catalog || rows === null) return <Spinner />;

  const labelOf = key => catalog.recordTypes.find(t => t.key === key)?.label || key;

  return (
    <div className="pb-4">
      <Header
        title="Workflow Logs"
        hint="Every attempt, including the ones whose criteria did not match — otherwise a workflow that did nothing and one that broke look the same."
        onRefresh={reload}
      />
      <LogTimeline
        rows={rows}
        emptyText="Nothing has run yet. A workflow logs here the first time its trigger fires."
        columns={[
          { key: 'workflowName', label: 'Name' },
          { key: 'recordType', label: 'Form', render: r => labelOf(r.recordType) },
          { key: 'triggerKind', label: 'Trigger Type', render: r => (r.triggerKind === 'date' ? 'Date' : 'Workflow') },
          { key: 'actionKind', label: 'Action Type', render: r => (
              r.actionKind === 'email_alert' ? 'Mail Alert' : r.actionKind === 'field_update' ? 'Field Update' : null) },
          { key: 'actionName', label: 'Action Name' },
          { key: 'subjectName', label: 'Employee' },
          { key: 'executedAt', label: 'Execution Time', render: r => time(r.executedAt) },
        ]}
      />
    </div>
  );
}

export function SchedulerLogs() {
  const { rows, reload } = useLogs('/workflows/scheduler-logs');
  if (rows === null) return <Spinner />;

  return (
    <div className="pb-4">
      <Header
        title="Scheduler Logs"
        hint="The scheduled sweeps. A run that had nothing to do is not recorded — ninety-six 'nothing happened' rows a day is a log nobody reads."
        onRefresh={reload}
      />
      <LogTimeline
        rows={rows}
        emptyText="No scheduled run has had anything to do yet."
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'kind', label: 'Type' },
          { key: 'executedAt', label: 'Execution Time', render: r => time(r.executedAt) },
          { key: 'durationMs', label: 'Took', render: r => (r.durationMs != null ? `${r.durationMs} ms` : null) },
        ]}
      />
    </div>
  );
}
