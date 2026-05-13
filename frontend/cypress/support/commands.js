/// <reference types="cypress" />

/**
 * Custom commands used by the E2E suite.
 *
 *  cy.loginAs('admin' | 'manager' | 'employee')
 *      — cached API login (one call per role per session via cy.session)
 *      — writes nxt_token + nxt_refresh_token into localStorage
 *
 *  cy.loginViaUi(email, password)
 *      — drives the actual login UI. Slow. Use only when testing the form.
 *
 *  cy.logout()
 *      — clears tokens. Does not hit the server.
 */

const SEEDED = {
  admin:    { email: 'admin@nxtpeople.com',   password: 'password123' },
  manager:  { email: 'sarah@nxtpeople.com',   password: 'password123' },
  employee: { email: 'michael@nxtpeople.com', password: 'password123' },
};

Cypress.Commands.add('loginAs', (role) => {
  const user = SEEDED[role.toLowerCase()];
  if (!user) throw new Error(`Unknown role: ${role}`);

  // cy.session caches the login result by key. The setup function only runs
  // once per role per spec; subsequent tests get the cached localStorage state
  // re-applied. This drops the test run from minutes to seconds AND avoids
  // tripping the auth rate limiter if it's ever enabled in test.
  cy.session(
    ['login', role],
    () => {
      cy.request({
        method: 'POST',
        url: '/api/auth/login',
        body: user,
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status, `${role} login`).to.eq(200);
        expect(res.body, 'no MFA challenge for seeded users').to.not.have.property('requiresMfa');
        window.localStorage.setItem('nxt_token', res.body.token);
        window.localStorage.setItem('nxt_refresh_token', res.body.refreshToken);
      });
    },
    {
      validate() {
        // Re-validate cached session against the server; if token expired the
        // setup function re-runs.
        cy.request({
          url: '/api/auth/me',
          headers: { Authorization: `Bearer ${window.localStorage.getItem('nxt_token')}` },
          failOnStatusCode: false,
        }).its('status').should('eq', 200);
      },
      cacheAcrossSpecs: true,
    }
  );
});

Cypress.Commands.add('loginViaUi', (email, password) => {
  cy.visit('/login');
  cy.get('input[type="email"]', { timeout: 10000 }).should('be.visible').type(email);
  cy.contains('button', 'Continue').click();
  cy.get('input[type="password"]', { timeout: 10000 }).should('be.visible').type(password);
  cy.contains('button', /sign in/i).click();
});

Cypress.Commands.add('logout', () => {
  cy.window().then((win) => {
    win.localStorage.removeItem('nxt_token');
    win.localStorage.removeItem('nxt_refresh_token');
  });
});
