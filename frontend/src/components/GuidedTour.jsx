import React from 'react';
import { X, ChevronLeft, ChevronRight, Clock, Calendar, CheckCircle, Users, BarChart2, FileText } from 'lucide-react';

const STEPS = [
  {
    icon: Clock,
    color: 'bg-blue-50 text-blue-600',
    title: 'Check In & Out',
    desc: 'Start your day by clicking "Check In" on the Home or Dashboard page. Your live timer runs while you\'re checked in. Click "Check Out" to record your total working hours.',
    tip: 'Your location is captured for attendance records.',
  },
  {
    icon: Calendar,
    color: 'bg-emerald-50 text-emerald-600',
    title: 'Apply for Leave',
    desc: 'Go to Leave Tracker → Leave Summary and click "Apply Leave". Choose the leave type (Casual, Permission, Comp-Off, or Unpaid), pick dates, add a reason, and submit.',
    tip: 'Your manager receives a notification and must approve the request.',
  },
  {
    icon: Clock,
    color: 'bg-sky-50 text-sky-600',
    title: 'Work From Home',
    desc: 'Apply for WFH from the Quick Actions menu (+ button in the top bar) or directly from the WFH page. Your manager will approve or reject it.',
    tip: 'WFH requests should be submitted before or on the day of work.',
  },
  {
    icon: CheckCircle,
    color: 'bg-amber-50 text-amber-600',
    title: 'Approvals',
    desc: 'Managers and approvers: go to Home → Team → Approvals to see all pending requests — leaves, permissions, regularizations, WFH, Comp-Off, and timesheets.',
    tip: 'Notifications link directly to the specific request waiting for your action.',
  },
  {
    icon: Users,
    color: 'bg-violet-50 text-violet-600',
    title: 'Team & Organization',
    desc: 'Explore your team under Home → Team. View the org chart under Home → Organization → Employee Tree. Find colleagues in the Directory.',
    tip: 'The Peers page shows different data based on your role — managers see their full reporting chain.',
  },
  {
    icon: FileText,
    color: 'bg-orange-50 text-orange-600',
    title: 'Documents',
    desc: 'Access company documents, payslips, and HR letters under More Services → Files or HR Letters. You can upload personal documents and download company files.',
    tip: 'HR letters are requested and approved by HR before becoming available.',
  },
  {
    icon: BarChart2,
    color: 'bg-rose-50 text-rose-600',
    title: 'Reports (Admin)',
    desc: 'Admins and HR can access detailed attendance and payroll reports under the Reports section. Filter by date, department, or employee and export data.',
    tip: 'For the Leave Tracker admin view, go to Leave Tracker → Team → All Requests.',
  },
];

export default function GuidedTour({ onClose }) {
  const [step, setStep] = React.useState(0);
  const current = STEPS[step];
  const Icon = current.icon;
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <span className="text-[13px] font-semibold text-slate-500">
            Step {step + 1} of {STEPS.length}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-slate-100">
          <div
            className="h-1 bg-blue-500 transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="p-6">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 ${current.color}`}>
            <Icon size={24} />
          </div>
          <h2 className="text-[18px] font-bold text-slate-900 mb-2">{current.title}</h2>
          <p className="text-[14px] text-slate-600 leading-relaxed mb-4">{current.desc}</p>
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
            <p className="text-[13px] text-blue-700 font-medium">💡 {current.tip}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={isFirst}
            className="flex items-center gap-1.5 px-4 py-2 text-[14px] font-medium text-slate-600 hover:text-slate-900 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={15} /> Previous
          </button>
          {isLast ? (
            <button
              onClick={onClose}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-semibold rounded-lg transition-colors"
            >
              Done
            </button>
          ) : (
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-semibold rounded-lg transition-colors"
            >
              Next <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
