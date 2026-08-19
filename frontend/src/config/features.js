// Feature switches for parts of the app that exist in code but are not in use
// yet. One place to flip, rather than hunting down every entry point — and the
// code stays in the build, so turning a feature back on is a one-line change
// rather than a revert.

// Payroll is built but not live for this org. While it is off, none of its
// entry points are shown: the sidebar item, the "Access my payroll" banner
// button, and the Payslips tab on the home overview.
//
// This hides the way in, not the routes themselves — /payroll/* still resolves
// for anyone typing the URL. That is deliberate: it keeps the module reachable
// for testing without advertising it to everyone.
export const PAYROLL_ENABLED = false;

// Time Tracker and Performance are not in use for this org either. Same
// treatment as payroll above: every way in is hidden — the sidebar icon, the
// Time Logs tab on the home overview, the Topbar sections, and the SmartChat
// shortcuts — while the routes themselves still resolve for anyone typing a
// URL, so the modules stay reachable for testing without being advertised.
//
// Performance was previously shown greyed out with a dead click. That told
// users it was planned, but a permanently inert icon reads as broken rather
// than forthcoming, so it is hidden outright.
export const TIME_TRACKER_ENABLED = false;
export const PERFORMANCE_ENABLED = false;
