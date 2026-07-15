import React, { useState } from 'react';
import { ChevronDown, ChevronRight, BookOpen, Clock, Calendar, CheckCircle, Users, FileText, BarChart2, Settings } from 'lucide-react';

const SECTIONS = [
  {
    icon: Clock,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    title: 'Attendance',
    items: [
      { q: 'How do I check in?', a: 'Go to Home → My Space → click "Check In". Your location may be requested. Once checked in, your live timer starts.' },
      { q: 'How do I check out?', a: 'Click "Check Out" on the Home / Dashboard page or Attendance page. Your total hours are saved automatically.' },
      { q: 'What is regularization?', a: 'If you forgot to check in or out on a past date, go to Attendance → Regularization and submit a request with the correct times. Your manager will approve it.' },
      { q: 'Can I see past attendance?', a: 'Yes. Go to Attendance → My Attendance to see daily records, working hours, and status (Present / Half-day / Absent / Late).' },
    ],
  },
  {
    icon: Calendar,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    title: 'Leave Tracker',
    items: [
      { q: 'How do I apply for leave?', a: 'Go to Leave Tracker → Leave Summary → click "Apply Leave". Choose the leave type, select dates, add a reason, and submit.' },
      { q: 'What leave types are available?', a: 'Casual Leave, Comp-Off, Permission (hourly), and Unpaid Leave. Balances are shown on the Leave Summary page.' },
      { q: 'How do I apply for Work From Home (WFH)?', a: 'Go to Leave Tracker → (WFH section) or use Quick Actions in the top bar. Select the date, add a reason, and submit.' },
      { q: 'What is Comp-Off?', a: 'Compensatory Off is earned when you work on a weekend or holiday. Go to Leave Tracker → Comp-Off, click "Apply Comp-Off", enter the worked date and the comp-off date you want.' },
      { q: 'How do I cancel a leave?', a: 'Go to Leave Tracker → Leave Summary, find your leave in the list, and click Cancel. Pending leaves can be cancelled; approved leaves require manager action.' },
    ],
  },
  {
    icon: CheckCircle,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    title: 'Approvals',
    items: [
      { q: 'Where do I see pending approvals?', a: 'Go to Home → Team → Approvals. You will see tabs for Leaves, Permissions, Regularizations, WFH, Comp-Off, and Timesheets.' },
      { q: 'How do I approve or reject a request?', a: 'On the Approvals page, find the pending request and click Approve or Reject. You can add a comment when rejecting.' },
      { q: 'Can I open a specific request from a notification?', a: 'Yes. Click the notification in the bell menu — it will navigate directly to the Approvals page and open that specific request.' },
    ],
  },
  {
    icon: Users,
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    title: 'Team & Organization',
    items: [
      { q: 'How do I see my team members?', a: 'Go to Home → Team → Team Space. Admins and Business Unit Heads see the full organization. Managers see their reporting chain. Regular employees see peers sharing the same manager.' },
      { q: 'How do I view the org chart?', a: 'Go to Home → Organization → Employee Tree to see the full organizational hierarchy.' },
      { q: 'How do I find a colleague\'s contact?', a: 'Go to Home → Organization → Directory and search by name, department, or designation.' },
    ],
  },
  {
    icon: FileText,
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    title: 'Documents & Files',
    items: [
      { q: 'Where can I upload or download documents?', a: 'Go to More Services → Files. You can upload personal documents (payslips, offer letters, etc.) and download company documents.' },
      { q: 'How do I get HR letters?', a: 'Go to More Services → HR Letters and request the letter type you need. HR will approve and upload it.' },
    ],
  },
  {
    icon: BarChart2,
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    title: 'Reports (Admin)',
    items: [
      { q: 'How do I access attendance reports?', a: 'Go to Reports → Attendance. You can filter by date range, employee, and department, then export.' },
      { q: 'How do I run payroll?', a: 'Go to Reports → Payroll. Ensure attendance data is complete for the month before running payroll.' },
    ],
  },
  {
    icon: Settings,
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    title: 'Profile & Settings',
    items: [
      { q: 'How do I update my profile photo?', a: 'Click your avatar in the top-right corner → My Profile → click the photo to upload a new one.' },
      { q: 'How do I change dark mode?', a: 'Click the moon/sun icon in the bottom bar (bottom-right area of the screen) to toggle dark mode.' },
      { q: 'How do I sign out from all devices?', a: 'Click your avatar → Sign out from all devices. This revokes all active sessions including mobile browsers.' },
    ],
  },
];

function Section({ section }) {
  const [open, setOpen] = useState(null);
  const Icon = section.icon;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${section.bg}`}>
          <Icon size={18} className={section.color} />
        </div>
        <h2 className="text-[16px] font-bold text-slate-800">{section.title}</h2>
      </div>
      <div className="divide-y divide-slate-50">
        {section.items.map((item, i) => (
          <div key={i}>
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50 transition-colors"
            >
              <span className="text-[14px] font-medium text-slate-700">{item.q}</span>
              {open === i ? <ChevronDown size={15} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={15} className="text-slate-400 flex-shrink-0" />}
            </button>
            {open === i && (
              <div className="px-5 pb-4 text-[14px] text-slate-600 leading-relaxed">
                {item.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Help() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <BookOpen size={20} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-[20px] font-bold text-slate-900">Help Center</h1>
          <p className="text-[14px] text-slate-500">Frequently asked questions and how-to guides</p>
        </div>
      </div>
      {SECTIONS.map(s => <Section key={s.title} section={s} />)}
    </div>
  );
}
