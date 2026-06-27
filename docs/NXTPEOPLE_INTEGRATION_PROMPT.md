# NxtPeople Integration Prompt

A generic prompt you paste into any AI coding assistant (Cursor, Claude,
Copilot Chat, ChatGPT) when integrating a new internal company app with
NxtPeople's access-check API.

**Same prompt works for every app — Node.js, Python, any framework.**

---

## How to use

1. Open your AI assistant inside the codebase you want to integrate (LMS,
   User Report, dashboards, anything internal)
2. Paste the entire block below as the first message
3. Answer the 2–3 clarifying questions the assistant asks about your
   stack
4. Hand it the API key when it asks
5. Review the diff, ship

---

## THE PROMPT — copy everything between the lines

```text
═══════════════════════════════════════════════════════════════════════
I need you to integrate THIS app with NxtPeople, our company's central
HR access controller. Follow these instructions exactly — do not invent
endpoints, env var names, or response shapes.

═══════════════════════════════════════════════════════════════════════
CONTEXT — what NxtPeople is and why we're doing this
═══════════════════════════════════════════════════════════════════════

NxtPeople (https://nxtpeople.altiusnxt.tech) is our master employee
directory. HR manages employee lifecycle there (joining, role changes,
offboarding) and picks per-employee which internal apps each person can
use.

Today this app has its own user list. Problem: when HR offboards
someone, they have to remember to remove the user from every internal
system. They forget. Ex-employees retain access for weeks.

The fix: this app keeps its own login (passwords/OAuth/SSO — whatever
it has now), but BEFORE letting a user in, it asks NxtPeople "is this
user still allowed?". One API call. NxtPeople returns yes/no.

What you're building is a 3-line addition to the existing login flow.
Do not rebuild authentication. Do not change the password/OAuth logic.
Only add the access gate AFTER successful authentication and BEFORE
session creation.

═══════════════════════════════════════════════════════════════════════
THE API CONTRACT — do not modify
═══════════════════════════════════════════════════════════════════════

Endpoint:
  POST https://nxtpeople.altiusnxt.tech/api/external/access/check

Headers:
  Content-Type: application/json
  X-API-Key:    <key issued by NxtPeople admin>

Body:
  { "email": "user@altiusnxt.com" }   ← always lowercased, trimmed

Allowed response (HTTP 200):
  {
    "allowed":     true,
    "employee":    {
      "id":          "uuid",
      "employeeId":  "ANXT2600147",
      "firstName":   "Alice",
      "lastName":    "Kumar",
      "email":       "alice@altiusnxt.com",
      "department":  "Software",
      "designation": "Software Developer",
      "photoUrl":    "https://..."     // may be null
    },
    "application": { "id": "uuid", "name": "App name as registered" }
  }

Denied response (HTTP 200 or 4xx):
  {
    "allowed": false,
    "reason":  "NOT_GRANTED"        // employee exists in HR but no access for this app
              | "EMPLOYEE_INACTIVE"  // employee was resigned/terminated
              | "NOT_FOUND"          // email not registered in NxtPeople
              | "INVALID_KEY"        // wrong/expired API key (config bug)
              | "RATE_LIMITED"       // > 600 checks per 15 min per key
              | "EMAIL_REQUIRED"     // empty/missing email in body
  }

═══════════════════════════════════════════════════════════════════════
YOUR TASK — 5 steps
═══════════════════════════════════════════════════════════════════════

STEP 1. Ask me for the API key.
   I will copy it from NxtPeople admin (More Services → Apps → Manage
   Apps & API Connections → eye icon on the app's card → copy). Do not
   generate or invent a key.

STEP 2. Add two env vars to the existing .env file:
     NXTPEOPLE_URL=https://nxtpeople.altiusnxt.tech
     NXTPEOPLE_API_KEY=<the key I gave you>
   Verify .env is in .gitignore. If it isn't, add it. NEVER commit the
   key to git.

STEP 3. Create a single helper module with one function `checkAccess(email)`.
   Use the helper snippet for this codebase's language (see below).
   Place it where other small utilities live (e.g. utils/, lib/, helpers/).

STEP 4. Find the existing login route — the function where the user's
   password or OAuth callback is verified today. Add the NxtPeople call
   RIGHT AFTER successful authentication and BEFORE session creation.

   Required behaviour:
     • allowed === true  → attach `access.employee` to the session/request
                            and continue to the existing session creation
     • allowed === false → return HTTP 403 with the reason. Suggested
                            user-facing messages:
         NOT_GRANTED       → "Your account exists, but HR hasn't granted
                              you access to this app. Contact HR."
         EMPLOYEE_INACTIVE → "Your employment status doesn't allow access.
                              Contact HR."
         NOT_FOUND         → "Email not recognised. Contact HR."
     • INVALID_KEY / RATE_LIMITED / NETWORK_ERROR / CONFIG_MISSING
                         → log the reason server-side, deny with a
                            generic "Login service temporarily unavailable"
                            — do not leak internal details to the user.

STEP 5. Tell me how to test after deploying. Provide:
     a. A curl command that hits NxtPeople directly to verify the key
        works
     b. A test scenario: grant a user in NxtPeople admin → try logging
        in → should succeed. Revoke → next login should be denied.

═══════════════════════════════════════════════════════════════════════
NODE.JS HELPER (Express, Fastify, Next.js API routes, any Node app)
═══════════════════════════════════════════════════════════════════════

Create utils/nxtpeople.js (or wherever helpers live):

  const NXT_URL = process.env.NXTPEOPLE_URL;
  const NXT_KEY = process.env.NXTPEOPLE_API_KEY;

  async function checkAccess(email) {
    if (!NXT_URL || !NXT_KEY) {
      console.error('NxtPeople env vars missing');
      return { allowed: false, reason: 'CONFIG_MISSING' };
    }
    try {
      const r = await fetch(`${NXT_URL}/api/external/access/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key':    NXT_KEY,
        },
        body: JSON.stringify({ email: String(email).toLowerCase().trim() }),
        signal: AbortSignal.timeout(5000),
      });
      return await r.json();
    } catch (err) {
      console.error('NxtPeople check failed:', err.message);
      return { allowed: false, reason: 'NETWORK_ERROR' };
    }
  }

  module.exports = { checkAccess };
  // or:  export { checkAccess };  // for ESM

Use it in the login route:

  const { checkAccess } = require('./utils/nxtpeople');

  // ── after the existing password / OAuth verification succeeds ────
  const access = await checkAccess(authenticatedEmail);
  if (!access.allowed) {
    return res.status(403).json({
      error:  'Access denied by HR',
      reason: access.reason,
    });
  }
  // ── continue with session creation, using access.employee ────────
  req.session.user = { ...existingUser, ...access.employee };

═══════════════════════════════════════════════════════════════════════
PYTHON HELPER (Flask, FastAPI, Django, any Python app)
═══════════════════════════════════════════════════════════════════════

Create nxtpeople.py:

  import os
  import logging
  import requests

  NXT_URL = os.getenv('NXTPEOPLE_URL')
  NXT_KEY = os.getenv('NXTPEOPLE_API_KEY')

  def check_access(email: str) -> dict:
      if not NXT_URL or not NXT_KEY:
          logging.error('NxtPeople env vars missing')
          return {'allowed': False, 'reason': 'CONFIG_MISSING'}
      try:
          r = requests.post(
              f'{NXT_URL}/api/external/access/check',
              json={'email': email.strip().lower()},
              headers={'X-API-Key': NXT_KEY},
              timeout=5,
          )
          return r.json()
      except Exception as e:
          logging.error(f'NxtPeople check failed: {e}')
          return {'allowed': False, 'reason': 'NETWORK_ERROR'}

Ensure `requests>=2.31.0` is in requirements.txt.

Use it in the login route. Pick the snippet matching the framework:

  • Flask:
      from nxtpeople import check_access
      access = check_access(email)
      if not access['allowed']:
          return jsonify(error='Access denied by HR',
                         reason=access['reason']), 403
      session['user'] = {**existing_user, **access['employee']}

  • FastAPI:
      from fastapi import HTTPException
      from nxtpeople import check_access
      access = check_access(email)
      if not access['allowed']:
          raise HTTPException(status_code=403, detail={
              'error':  'Access denied by HR',
              'reason': access['reason'],
          })

  • Django:
      from django.http import JsonResponse
      from nxtpeople import check_access
      access = check_access(email)
      if not access['allowed']:
          return JsonResponse({'error':  'Access denied by HR',
                               'reason': access['reason']}, status=403)

═══════════════════════════════════════════════════════════════════════
RULES — DO NOT VIOLATE
═══════════════════════════════════════════════════════════════════════

1. SERVER-SIDE ONLY. The X-API-Key must never appear in client-side
   code, browser bundles, mobile apps, or any file that ships to a
   user's device. If this is a SPA, the check goes through this app's
   own backend — not directly from the browser.

2. ALWAYS LOWERCASE THE EMAIL before sending. NxtPeople stores emails
   lowercased. The helpers above already do this — do not bypass them.

3. 5-SECOND TIMEOUT (or shorter). NxtPeople being slow must never
   hang user logins.

4. NO LONG CACHING. If you add caching for performance, cap at 60
   seconds. Caching for longer means a revoked user keeps access for
   that long.

5. FAIL CLOSED. If NxtPeople is unreachable (network error, timeout,
   500), deny access. NEVER default to allowed=true on failure.

6. NO KEY IN CODE. Not in source files, not in comments, not in commit
   messages, not in any client-shipped file. Only in runtime .env /
   secrets manager.

7. PRESERVE EXISTING AUTH. Do not refactor or replace the existing
   password/OAuth logic. The NxtPeople check is an ADDITIONAL gate
   placed AFTER existing authentication.

═══════════════════════════════════════════════════════════════════════
QUESTIONS — ask me BEFORE writing code if unclear from the codebase
═══════════════════════════════════════════════════════════════════════

1. What stack is this codebase?
   (Express / Fastify / Next.js / Flask / FastAPI / Django / other)

2. Where is the login route? Show me the file path and the function
   where password/OAuth verification happens today.

3. How does this app respond on auth failure currently?
   - JSON error (API/SPA)
   - HTML redirect (server-rendered)
   - Render error template inline
   I'll want the NxtPeople denial to use the same response style for
   consistency.

4. Is there an existing helper for outbound HTTP calls (axios, got,
   internal client)? If yes, I'll match its style.

5. What's the API key value? (Paste it; I'll add to .env, never commit.)

═══════════════════════════════════════════════════════════════════════
"DONE" CHECKLIST — verify all of these before claiming completion
═══════════════════════════════════════════════════════════════════════

[ ] .env has NXTPEOPLE_URL and NXTPEOPLE_API_KEY
[ ] .gitignore covers .env
[ ] utils/nxtpeople.js (or nxtpeople.py) exists with checkAccess()
[ ] Login route calls checkAccess after the existing auth verification
[ ] Three response paths handled: allowed / denied-with-reason / error
[ ] Generic failure message shown for INVALID_KEY / NETWORK_ERROR — no
    internal details leaked to the user
[ ] Tested with curl from a terminal — key works
[ ] Tested live: granted user logs in successfully
[ ] Tested live: ungranted user is blocked with a clear message
[ ] No API key committed to git (grep the repo to confirm)
═══════════════════════════════════════════════════════════════════════
```

---

## Tips for your team

- **Per app, you need:** one new connection in NxtPeople admin → copy the API key → paste into that app's `.env` → run the prompt above on the AI assistant inside that codebase.
- **Same key never gets reused across apps.** Each app = its own connection = its own key. This way revoking one app doesn't break others.
- **If a key leaks:** open NxtPeople admin → click rotate on that connection → paste the new key into the leaked app's `.env` → restart. The old key dies instantly.
- **For SSO later:** when you're ready to upgrade from "each app has its own login + NxtPeople gate" to true single sign-on (one NxtPeople login that authenticates everything), the access table we built already supports that — only the auth flow needs to change, not the access model.
