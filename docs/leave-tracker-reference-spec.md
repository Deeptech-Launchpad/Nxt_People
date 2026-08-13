# Leave Tracker reports — reference spec

Captured from the reference product's screenshots. This exists so the next
session can implement without re-deriving the structure, and so decisions
already settled aren't re-litigated.

Status legend: **DONE** shipped · **PARTIAL** shipped but incomplete · **TODO** not started.

---

## 1. Overflow (`⋯`) menu — differs per page

Every Leave Tracker page has one (unlike Employee Information, which has only
the funnel). Contents are **not** uniform:

| Page | `⋯` contents |
|---|---|
| Daily leave status | Export · Print · Download as PDF |
| Resource availability | Export · Download as PDF · Download as ICS · Print · Permissions |
| Employee leave balance | **Print only** |
| Leave booked and balance | Export |
| Leave type wise summary | Export · Print · Download as PDF |
| Leave encashment details | Export · Download as PDF · Print |
| Loss of pay details | **Import** · Export · Print · **Push To Payroll** |
| Leave data for payroll | Export · Download as PDF · Print · Permissions |

Status: **PARTIAL** — `ReportMenu` component exists and Resource Availability
is wired. Remaining pages TODO.

Decisions already taken:
- **Permissions is not implemented** — no per-report ACL exists in this app; a
  dead menu entry is worse than an absent one.
- **Print / Download as PDF** both go through the browser print pipeline plus
  the print stylesheet in `index.css`. No PDF dependency was added.
- **Download as ICS** is implemented in `utils/reportIcs.js` (DTEND exclusive,
  75-octet line folding).
- **Import / Push To Payroll** on Loss of Pay are unbuilt features, not just
  menu wiring. Do not add the entries until the actions exist.

---

## 2. Employee leave balance — the biggest gap

Currently the simplest of our pages; the reference has three layers.

**Header:** `Day | Hour` toggle · chart/list icon toggle · `⋯` (Print only) ·
an employee chip (`ANXT220012 Amarnath`) in the breadcrumb.

**Chart view:** stacked bar per leave type, y-axis labelled `Day Leave Chart` /
`Hour Leave Chart`. Hour mode shows only hour-based types (Permission).

**List view:** `Leavetype | Current Balance`, both sortable, colour swatch per
type. A `⋯` per row opens **Summary** and **History**.

**Summary modal** — title = leave type, a From/To date pair, columns:
`Period | Granted | Booked | Balance | Lapsed`, one row per month.

**History modal** — same header plus an export icon, columns:
`Date | Type | Added | Booked | Balance`. `Type` values seen: `Report
Initiated`, `Accrual`, `Leave Taken`.

Status: **TODO**. Needs a backend ledger endpoint — we have no accrual history
table, so `Accrual` rows would have to be derived from the leave-type policy.
**Flag before building:** this may not be reconstructable from current schema.

---

## 3. Leave data for payroll — Report Type

`Report Type : Default | Detailed` chip.

- **Default:** `Total days | Loss of pay | Paid days` (Hour mode: `Total hours
  | Loss of pay | Paid hours`, formatted `248:00`).
- **Detailed:** `Total | Weekend | Holidays | Payable | On Duty |
  Leave{Paid, Unpaid, Comp…, Total} | Loss of pay | Paid` — `Leave` is a
  merged banner over four sub-columns.

Status: **TODO**. Note Day mode shows fractional days (`2.125`, `0.2708333`) —
do not round.

---

## 4. Pay Period pages

Loss of pay, Leave encashment, and Leave data for payroll all carry a
`Pay Period : ANXT Payroll` chip (a searchable dropdown) and a **Regenerate
Report** button, instead of a date-range navigator.

Status: **TODO**. We have no pay-period entity; this is a payroll-module
concept. Needs a decision before building.

---

## 5. Leave booked and balance

- `Day | Hour` toggle.
- `Type` filter: All · Paid · Unpaid · On Duty · Compensatory Off ·
  Restricted Holidays.
- Three-row grouped header: category → leave type → `Booked | Balance`.
- Hour mode narrows to hour-based types only and shows raw decimals
  (`0.76667`, `27.23`).
- Exit dates render under the name as `( Exit Date - 31/07/2026 )`.

Status: **PARTIAL** — grouped export header done; `Type` filter and Hour-mode
narrowing TODO.

---

## 6. Leave encashment — empty state

Shows an illustration plus *"Enable 'Process leave encashment' in Pay Period
settings to view Leave encashment details"* and a **Configuration** button.
The filter row and `⋯` remain available above it.

Status: **TODO** — worth copying; a real empty state beats a blank table.

---

## 7. Leave type names

The reference has **year-suffixed leave types**: `Casual Leave`, `Casual Leave
2023`, `Casual Leave 2024`, `Casual Leave2025`, `Permission`, `Permission2022`,
`Compensatory Off`, `Leave Without Pay`, `Absent`.

Ours has four flat types (`casual`, `comp_off`, `unpaid`, `permission`), so
codes will never match one-for-one. Pulling the real catalogue via the existing
Zoho API integration (`utils/zoho.js`, `ZOHO_REFRESH_TOKEN`) is the only way to
reconcile these.

Status: **TODO** — decision needed on whether to model per-year leave types.

---

## 8. Confirmed already-correct

- Export dialog: illustration, radio format group defaulting to **XLS**,
  `Include additional employee fields` with Reporting To / Department /
  Designation / Location / Role. Leave Tracker offers TSV; Attendance does not.
- Filter rows visible on load, Submit + Reset right-aligned.
- Employee Status: Active Users / Active Non-Users / Ex-Employees / Login
  Disabled, with `Show selective ex-employees` beside it.
- Period presets: Yesterday · Today · Last Month · This Month · Last Year ·
  This Year · Custom.
