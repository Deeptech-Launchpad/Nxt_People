import React, { useState } from 'react';
import { Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const monthStartCA = () => new Date(new Date().setDate(1)).toLocaleDateString('en-CA');

// Generic "pick a range, download an Excel file" report page — covers
// Leave data for payroll and Attendance data for payroll. The backend
// returns plain JSON; the workbook is built client-side with the same
// xlsx library the main Attendance Reports page already uses for exports.
export default function ExportReportPage({ title, subtitle, endpoint, columns, sheetName, fileStub }) {
  const [startDate, setStartDate] = useState(monthStartCA());
  const [endDate, setEndDate] = useState(todayCA());
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const r = await api.get(`${endpoint}?startDate=${startDate}&endDate=${endDate}`);
      const rows = Array.isArray(r.data.data) ? r.data.data : [];
      if (!rows.length) { toast.error('No data for the selected range'); return; }
      const aoa = [columns.map(c => c.header), ...rows.map(row => columns.map(c => row[c.key] ?? ''))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, `${fileStub}-${startDate}_to_${endDate}.xlsx`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Export failed');
    } finally {
      setDownloading(false);
    }
  };

  const filters = (
    <>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">From</label>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
      </div>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">To</label>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
      </div>
      <button onClick={download} disabled={downloading}
        className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors disabled:opacity-60">
        <Download size={14} /> {downloading ? 'Preparing…' : 'Download Excel'}
      </button>
    </>
  );

  return (
    <ReportShell title={title} subtitle={subtitle} filters={filters} loading={false}>
      <div className="p-8 text-center text-slate-500">
        Pick a date range above, then click <strong>Download Excel</strong>.
      </div>
    </ReportShell>
  );
}
