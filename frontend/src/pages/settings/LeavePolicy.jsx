import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const PAY_TYPES = [['paid', 'Paid'], ['unpaid', 'Unpaid'], ['comp_off', 'Compensatory Off']];
const UNITS = [['days', 'Days'], ['hours', 'Hours']];
const ACCRUAL_MODES = [
  ['annual', 'Annual — granted once'],
  ['monthly', 'Monthly — accrues each month'],
  ['earned', 'Earned — credited as worked'],
  ['none', 'None — no entitlement'],
];

const PAY_TYPE_STYLE = {
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  unpaid: 'bg-rose-50 text-rose-700 border-rose-200',
  comp_off: 'bg-violet-50 text-violet-700 border-violet-200',
};

// Leave Policy configuration. These rows are not cosmetic — accrual mode and
// amount are what the balance reports read to decide how a type grants, and
// unit decides whether a type appears in Day or Hour mode at all. Editing one
// changes reported balances, which is why each change saves individually and
// says so rather than batching behind a single Save.
export default function LeavePolicy() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/leave-types/policies')
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load leave policies'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const patch = (row, changes) => {
    // Optimistic: the row is a single record and the request is small, so
    // reverting on failure is cheaper than making every edit feel laggy.
    const previous = rows;
    setRows(rs => rs.map(r => (r._id === row._id ? { ...r, ...changes } : r)));
    setSavingId(row._id);
    api.patch(`/leave-types/policies/${row._id}`, changes)
      .then(() => toast.success(`${row.name} updated`))
      .catch(err => {
        setRows(previous);
        toast.error(err.response?.data?.message || 'Could not save that change');
      })
      .finally(() => setSavingId(null));
  };

  const enabled = rows.filter(r => r.isActive);
  const disabled = rows.filter(r => !r.isActive);

  const Row = ({ row }) => (
    <tr className={`border-b border-slate-100 ${savingId === row._id ? 'opacity-60' : ''}`}>
      <td className="px-4 py-3">
        <span className="flex items-center gap-2.5">
          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: row.color || '#94a3b8' }} />
          <span className="text-[14px] text-slate-800">{row.name}</span>
          <span className="text-[11px] text-slate-400">{row.code}</span>
        </span>
      </td>
      <td className="px-4 py-3">
        <select
          value={row.payType} onChange={e => patch(row, { payType: e.target.value })}
          className={`text-[12.5px] rounded border px-2 py-1 ${PAY_TYPE_STYLE[row.payType] || 'border-slate-200'}`}
        >
          {PAY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <select
          value={row.unit} onChange={e => patch(row, { unit: e.target.value })}
          className="text-[12.5px] rounded border border-slate-200 px-2 py-1"
        >
          {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <select
          value={row.accrualMode} onChange={e => patch(row, { accrualMode: e.target.value })}
          className="text-[12.5px] rounded border border-slate-200 px-2 py-1 max-w-[220px]"
        >
          {ACCRUAL_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        {/* An earned or entitlement-free type has no fixed amount to set. */}
        {['annual', 'monthly'].includes(row.accrualMode) ? (
          <span className="flex items-center gap-1.5">
            <input
              type="number" min="0" step="0.5" defaultValue={row.accrualAmount}
              onBlur={e => {
                const v = Number(e.target.value);
                if (v !== row.accrualAmount) patch(row, { accrualAmount: v });
              }}
              className="w-20 text-[12.5px] rounded border border-slate-200 px-2 py-1 text-right"
            />
            <span className="text-[12px] text-slate-400">{row.unit === 'hours' ? 'hrs' : 'days'}</span>
          </span>
        ) : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-3 text-center">
        <button
          onClick={() => patch(row, { isActive: !row.isActive })}
          role="switch" aria-checked={row.isActive}
          title={row.isActive ? 'Disable this policy' : 'Enable this policy'}
          className={`w-10 h-5 rounded-full transition-colors relative ${row.isActive ? 'bg-blue-600' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${row.isActive ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </td>
    </tr>
  );

  const Table = ({ items }) => (
    <table className="w-full">
      <thead className="bg-slate-50 text-[12px] font-semibold text-slate-600">
        <tr>
          <th className="text-left px-4 py-2.5">Leave policy</th>
          <th className="text-left px-4 py-2.5">Type</th>
          <th className="text-left px-4 py-2.5">Unit</th>
          <th className="text-left px-4 py-2.5">Accrual</th>
          <th className="text-left px-4 py-2.5">Amount</th>
          <th className="text-center px-4 py-2.5">Status</th>
        </tr>
      </thead>
      <tbody>{items.map(r => <Row key={r._id} row={r} />)}</tbody>
    </table>
  );

  return (
    <div className="w-full max-w-full min-w-0 px-4 py-5 space-y-5">
      <div>
        <h1 className="text-[17px] font-semibold text-slate-800">Leave Policy</h1>
        <p className="text-sm text-slate-500 mt-1">
          How each leave type is paid, measured and granted. These settings drive the
          balances shown across the Leave Tracker reports.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <Table items={enabled} />
          </div>

          {disabled.length > 0 && (
            <div>
              <p className="text-[13px] text-slate-500 mb-2">
                Not in use — enable one to make it available when applying for leave.
              </p>
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden opacity-75">
                <Table items={disabled} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
