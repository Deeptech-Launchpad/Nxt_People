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

Status: **PARTIAL** — `ReportMenu` component exists; Resource Availability and
Employee leave balance are wired. Remaining pages TODO.

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

**DECIDED — build it.** Summary is the monthly roll-up; History is the
transaction-level detail behind it. My earlier concern (that deriving accrual
rows would misreport anyone whose policy changed mid-year) does not apply here:
this system stores a single flat allocation per employee
(`employees.casual_leave` and siblings) with no policy history, so the
derivation is exact for our model rather than a reconstruction.

These rules are no longer written into the report code. `leave_types` carries
`accrual_mode` (annual / monthly / earned / none) and `accrual_amount`, edited
on Configuration → Leave Policy, and `utils/leavePolicy.js` is the single place
that reads them for all three endpoints. Casual keeps `employees.casual_leave`
as its amount — that column is the per-employee allocation and the policy only
supplies the schedule. `leaves.js` reads the same policy for the permission
monthly cap, so what an employee may apply for and what their balance says
they have cannot disagree.

Accrual differs by type, and the reference shows both shapes:
- **Casual Leave** — whole annual allocation granted once, then `Granted` is
  blank for later months. Granted **on the joining date** for a mid-year
  joiner, not the preceding January, and in full — it is not pro-rated.
- **Permission** — 4 accrued every month, **pro-rated in the joining month**
  by the share of it worked: joining 03/01 of a 31-day January accrues
  4 × 29/31 = `3.74`, then 4 a month after. Months before joining accrue
  nothing rather than a zero row.

Both figures come from one shared helper, so the monthly Summary and the
transaction History can't disagree about what was granted.

`Lapsed` stays `-`: there is no lapse policy, and the reference shows `-` too.

Status: **DONE** — all three layers built on the existing `balance-user`,
`balance-user-detail`, and `balance-user-history` endpoints.

Two deliberate divergences from the reference:
- The page keeps its own **Export** button in the filter row. The reference has
  no export here at all, but this one already shipped and works; dropping a
  working action to match a screenshot is a loss, not a fix.
- Both modals carry the From/To pair, defaulting to Jan 1 → today. It narrows
  **which rows are listed**; the figures stay the year's running totals,
  because balance is cumulative — a From/To that recomputed a partial-year
  balance would report a number that isn't the employee's actual balance.

The reference's own header reads `Leavetype`; ours says `Leave Type`. That is
a typo in their product, not a design choice worth copying.

**Absent** is drillable too, though it isn't a leave type — it's attendance
days with no grant behind it. The reference leaves that row without a `⋯`; a
row on the report that won't open reads as broken, so both endpoints accept
`absent`, with Granted/Added empty and the running figure counting absences
upward instead of draining an entitlement.

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

**DECISION REVERSED — built.** The earlier call was to defer the pay-period
entity until the payroll module needed it. That was overruled: the entity is
now its own thing (`pay_periods` — name, date range, `process_encashment`,
active flag) under Configuration → Pay Period, rather than something payroll
owns.

Two divergences from the reference, both deliberate:
- The chip **adds to** the date-range navigator instead of replacing it. Its
  first option is `Custom range`, which hands the From/To chips back. A range
  you can't get out of is a worse filter than one you can.
- Nothing is selected by default and the chip hides itself entirely when no
  period exists, so the three reports behave exactly as before until someone
  creates one and picks it.

**Regenerate Report** is still not wired to the entity — it re-runs the report,
which is what it already did.

Status: **DONE**.

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

Status: **DONE** — shown when the selected pay period has `process_encashment`
off, with the Configuration button routing to Configuration → Pay Period. It
is not shown when no period is selected: with no period picked there is no
flag to be off, and claiming otherwise would be a lie about why the table is
empty. An icon stands in for the reference's illustration.

---

## 7. Leave type names

The reference has **year-suffixed leave types**: `Casual Leave`, `Casual Leave
2023`, `Casual Leave 2024`, `Casual Leave2025`, `Permission`, `Permission2022`,
`Compensatory Off`, `Leave Without Pay`, `Absent`.

**DECIDED — do not replicate.** Those suffixes are an artefact of the reference
product having been in use for several years; it creates a fresh leave type
each year, so the list is history rather than design. Our four flat types
(`casual`, `comp_off`, `unpaid`, `permission`) are the intended model.

Consequence to accept deliberately: grid codes will read `CL`/`PM` where the
reference reads `CL6`/`PM6`. That is correct for our data, not a gap to close.

Status: **CLOSED — no work needed.**

---

## 8. Configuration — the seven items

The reference gathers the Leave Tracker's rules under a Configuration section.
Ours lives at `/leave-tracker/configuration`; before it existed the Leave
Policy screen had a route and nothing anywhere linked to it.

**DECIDED — hub, not duplicate screens.** Work Calendar, Holidays and
Compensatory Off already had working screens elsewhere in the app. The hub
points at those and each item's work is to expose the rules the code still
hardcoded, in the same spirit as Leave Policy. Rows are only listed once the
thing they open exists.

| # | Item | Status | What it turned out to be |
|---|---|---|---|
| 1 | Leave Policy | **DONE** | `accrual_mode` / `accrual_amount`, now read by the balance endpoints and the permission cap in `leaves.js` |
| 2 | Work Calendar | **DONE** | `settings.full_day_hours` — attendance and regularizations both hardcoded a 7.5-hour full day while the half-day figure beside it was configurable |
| 3 | Holidays | **PARTIAL** | The Holidays screen offered **Restricted Holiday** but every consumer treated any type other than `working_day` as a company-wide closure, so picking it silently shut the office. Restricted now leaves the day as the weekend rules found it |
| 4 | Compensatory Off | **DONE** | Eligibility now reads the work calendar instead of assuming Sat/Sun, and `settings.comp_off_expiry_months` replaces the hardcoded 3 |
| 5 | Reports | **BLOCKED** | see below |
| 6 | Pay Period | **DONE** | see §4 |
| 7 | Leave Request | **DONE** | the permission monthly and per-request caps now come from the Leave Policy accrual rather than a literal 4 |

**Item 3 remainder.** A restricted holiday is now correctly optional, but there
is no way for an employee to opt into one and no per-year cap on how many they
may take. That is a feature (a table, an apply flow, and a limit), not a
hardcoded rule waiting to be exposed, so it was not built under this item. The
cap setting was deliberately *not* added in the meantime: an unenforced limit
on a settings screen is the dead-entry problem from §1.

**Item 5 is blocked on a decision.** The reference's Configuration → Reports is
per-report Permissions, and §1 already records the decision not to implement
per-report ACLs because none exists in this app. Building it means building an
authorization system, not wiring a knob. Either that decision stands and item 5
is closed as out of scope, or it is reversed the way Pay Period was — but it
should be an explicit call, not something smuggled in under a configuration
screen.

---

## 9. Confirmed already-correct

- Export dialog: illustration, radio format group defaulting to **XLS**,
  `Include additional employee fields` with Reporting To / Department /
  Designation / Location / Role. Leave Tracker offers TSV; Attendance does not.
- Filter rows visible on load, Submit + Reset right-aligned.
- Employee Status: Active Users / Active Non-Users / Ex-Employees / Login
  Disabled, with `Show selective ex-employees` beside it.
- Period presets: Yesterday · Today · Last Month · This Month · Last Year ·
  This Year · Custom.
