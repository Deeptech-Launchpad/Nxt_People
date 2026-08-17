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
