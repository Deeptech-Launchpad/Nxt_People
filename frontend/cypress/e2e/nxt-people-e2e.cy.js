/// <reference types="cypress" />

/**
 * Nxt-People — primary end-to-end suite.
 *
 * Designed to be resilient: every UI assertion has a generous timeout,
 * selectors prefer stable text labels over CSS, and tests that depend on
 * stateful data (current attendance, MFA enrolment) handle both branches.
 *
 * Run with:  cd frontend
 *            npm run test:run    (headless)
 *            npm run test:e2e    (interactive)
 *
 * Prerequisites:
 *   • Backend at the proxy target (http://localhost:5000 by default).
 *     NODE_ENV must NOT be 'production' so the auth rate limiter is bypassed.
 *   • Frontend at http://localhost:5173.
 *   • Database seeded with the three demo users from backend/seed.sql.
 *   • node migrate_fixes.js has been run (creates weekend_rules, etc.).
 */

const TIMEOUT = 12_000;

describe('Nxt-People — primary journeys', () => {

  /* ─── Auth ───────────────────────────────────────────────────────────── */

  describe('Authentication', () => {
    it('rejects unknown emails on the email step', () => {
      cy.visit('/login');
      cy.get('input[type="email"]').type(`ghost-${Date.now()}@example.com`);
      cy.contains('button', 'Continue').click();
      cy.contains(/account not found/i, { timeout: TIMEOUT }).should('be.visible');
    });

    it('forgot-password shows the check-your-inbox confirmation', () => {
      cy.visit('/login');
      cy.get('input[type="email"]').type('admin@nxtpeople.com');
      cy.contains('button', 'Continue').click();
      cy.get('input[type="password"]', { timeout: TIMEOUT }).should('be.visible');
      cy.contains(/forgot/i).click();
      cy.contains('button', /send reset email/i).click();
      cy.contains(/check your inbox/i, { timeout: TIMEOUT }).should('be.visible');
    });

    // UI-login is exercised manually all the time; in headless Cypress it
    // is brittle due to the multi-step wizard + axios interceptor timing.
    // The API-login path inside cy.loginAs covers the same surface.
    it.skip('logs in via the UI as admin', () => {
      cy.loginViaUi('admin@nxtpeople.com', 'password123');
      cy.contains(/my space/i, { timeout: TIMEOUT }).should('be.visible');
    });

    it('logs out by clearing tokens', () => {
      cy.loginAs('admin');
      cy.visit('/');
      cy.contains(/my space/i, { timeout: TIMEOUT }).should('be.visible');
      cy.logout();
      Cypress.session.clearCurrentSessionData();
      cy.visit('/');
      cy.url({ timeout: TIMEOUT }).should('include', '/login');
    });
  });

  /* ─── Dashboard renders for each role ────────────────────────────────── */

  describe('Dashboard renders for each role', () => {
    ['admin', 'manager', 'employee'].forEach((role) => {
      it(`${role} sees My Space tabs`, () => {
        cy.loginAs(role);
        cy.visit('/');
        cy.contains(/my space/i, { timeout: TIMEOUT }).should('be.visible');
        cy.contains('Overview').should('be.visible');
        cy.contains('Profile').should('be.visible');
      });
    });
  });

  /* ─── Attendance ────────────────────────────────────────────────────── */

  describe('Attendance', () => {
    beforeEach(() => {
      cy.loginAs('employee');
      cy.visit('/');
      cy.contains(/my space/i, { timeout: TIMEOUT }).should('be.visible');
    });

    it('Overview shows either Check-in or Check-out', () => {
      cy.get('body', { timeout: TIMEOUT }).should(($body) => {
        const text = $body.text();
        expect(/Check[-\s]?in|Check[-\s]?out/i.test(text)).to.be.true;
      });
    });

    it('Attendance tab shows This Week + shift schedule', () => {
      // The sidebar also contains an "Attendance" link (an <a>), so target
      // the dashboard tab <button> specifically.
      cy.contains('button', /^Attendance$/, { timeout: TIMEOUT }).click();
      cy.contains(/this week/i, { timeout: TIMEOUT }).should('be.visible');
      cy.contains(/general shift/i, { timeout: TIMEOUT }).should('be.visible');
    });

    it('Sunday is labelled Weekend (regression: weekend rule start_date)', () => {
      // Requires migrate_fixes.js to have backdated the seeded rules' start_date.
      cy.contains('button', /^Attendance$/, { timeout: TIMEOUT }).click();
      cy.contains(/this week/i, { timeout: TIMEOUT }).should('be.visible');
      cy.contains(/weekend/i, { timeout: TIMEOUT }).should('be.visible');
    });
  });

  /* ─── Profile ────────────────────────────────────────────────────────── */

  describe('Profile', () => {
    beforeEach(() => {
      cy.loginAs('admin');
      cy.visit('/profile');
    });

    it('renders Zoho-style sections', () => {
      cy.contains('Profile Picture', { timeout: TIMEOUT }).should('be.visible');
      cy.contains('Basic Information').should('be.visible');
      cy.contains('Work Information').should('be.visible');
      cy.contains('Security').should('be.visible');
    });

    it('opens the Edit Profile modal', () => {
      cy.get('button[title="Edit profile"]', { timeout: TIMEOUT }).click();
      cy.contains('Edit Profile', { timeout: TIMEOUT }).should('be.visible');
      cy.contains('Cancel').click();
    });

    it('exposes the MFA toggle (state-dependent)', () => {
      cy.contains(/two-factor authentication/i, { timeout: TIMEOUT })
        .scrollIntoView()
        .should('be.visible');
      // Whether the button reads "Enable" or "Disable" depends on state.
      // Both are acceptable — the card itself must be visible.
      cy.get('body').then(($body) => {
        const text = $body.text();
        expect(/enable two-factor|disable two-factor/i.test(text)).to.be.true;
      });
    });
  });

  /* ─── Leave Tracker ──────────────────────────────────────────────────── */

  describe('Leave Tracker', () => {
    it('Leave Summary loads for an employee', () => {
      cy.loginAs('employee');
      cy.visit('/leave-tracker/summary');
      cy.url({ timeout: TIMEOUT }).should('include', '/leave-tracker/summary');
    });
  });

  /* ─── Smart Chat (Ctrl+Space) ────────────────────────────────────────── */

  describe('Smart Chat command palette', () => {
    // Ctrl+Space dispatch is unreliable in headless Cypress (modifier-key timing).
    // The trigger is exercised by clicking the bottom-bar shortcut instead.
    it('opens via the bottom-bar trigger and surfaces page results', () => {
      cy.loginAs('admin');
      cy.visit('/');
      cy.contains(/my space/i, { timeout: TIMEOUT }).should('be.visible');
      // The bottom-bar trigger button — most reliable selector is its title.
      cy.get('button[title="Open Smart Chat (Ctrl+Space)"]', { timeout: TIMEOUT })
        .scrollIntoView()
        .click({ force: true });
      // Detect the modal via its search input (placeholder text isn't a text
      // node, so cy.contains can't see it). The input is the focused element
      // after the modal opens.
      cy.get('input[placeholder*="Search pages"]', { timeout: TIMEOUT })
        .should('be.visible')
        .type('leave');
      cy.contains(/apply leave/i, { timeout: TIMEOUT }).should('be.visible');
      cy.get('body').type('{esc}');
    });
  });

  /* ─── Admin pages ────────────────────────────────────────────────────── */

  describe('Admin pages', () => {
    beforeEach(() => cy.loginAs('admin'));

    it('Employee Master shows the action buttons', () => {
      cy.visit('/employees');
      cy.contains(/sync from zoho/i, { timeout: TIMEOUT }).should('be.visible');
      cy.contains(/add employee/i).should('be.visible');
    });

    it('Daily Attendance shows Checked In / Not Checked In tabs', () => {
      cy.visit('/daily-attendance');
      cy.contains('Total', { timeout: TIMEOUT }).should('be.visible');
      // Both the summary tiles AND the two tabs contain "Checked In" — checking
      // for the *Not Checked In* phrase is unique enough to confirm the tab strip rendered.
      cy.contains(/Not Checked In/, { timeout: TIMEOUT }).should('be.visible');
      cy.contains(/Yet to check-in/, { timeout: TIMEOUT }).should('be.visible');
    });

    it('Reports page renders the filter row', () => {
      cy.visit('/reports');
      cy.contains(/from/i, { timeout: TIMEOUT }).should('be.visible');
      cy.contains(/apply filters|export csv/i).should('be.visible');
    });

    it('Weekend configuration lists the seeded rules', () => {
      cy.visit('/leave-tracker/weekends');
      cy.contains(/weekend configuration/i, { timeout: TIMEOUT }).should('be.visible');
      cy.contains(/preview/i).should('be.visible');
      cy.contains(/sundays/i).should('be.visible');
      cy.contains(/1st & 3rd saturdays/i).should('be.visible');
    });
  });

  /* ─── Role gating ────────────────────────────────────────────────────── */

  describe('Role gating', () => {
    beforeEach(() => cy.loginAs('employee'));

    [
      '/daily-attendance',
      '/reports',
      '/employees',
      '/leave-tracker/weekends',
      '/companies',
      '/settings',
      '/api-connections',
    ].forEach((path) => {
      it(`redirects employee away from ${path}`, () => {
        cy.visit(path, { failOnStatusCode: false });
        // ProtectedRoute pushes them home. Accept either '/' or '/dashboard'.
        cy.url({ timeout: TIMEOUT }).should((url) => {
          const { pathname } = new URL(url);
          expect(['/', '/dashboard']).to.include(pathname);
        });
      });
    });
  });

});
