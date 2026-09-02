/* Rate limiting identity behind two proxies.
 *
 * nxtpeople runs client -> VPS nginx (TLS) -> container nginx -> Express.
 * Both proxies append to X-Forwarded-For, so the header arriving here is
 * `realClientIP, 127.0.0.1`. With `trust proxy: 1` Express trusted one hop and
 * resolved req.ip to 127.0.0.1 for everybody, which collapsed every per-IP
 * limiter into a single company-wide bucket and locked the office out of login
 * every morning.
 *
 * Two things have to hold, and the second is the reason this file exists:
 *
 *   1. req.ip is the real client, so limiters bill per person.
 *   2. A client that FORGES X-Forwarded-For cannot change who it is billed as.
 *      Over-trusting is the opposite bug and a worse one: on /auth/login it
 *      would hand an attacker unlimited password attempts by rotating a header.
 *
 * The trust setting is read from the real app, not redeclared here, so this
 * fails if somebody changes app.js back to a hop count.
 */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

const express = require('express');
const proxyaddr = require('proxy-addr');
const http = require('http');
const app = require('./app');
const pool = require('./db');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          got: ' + JSON.stringify(x)}`); };

// The compiled trust function Express actually uses, taken from the real app.
const trust = app.get('trust proxy fn');

// socketAddr = who physically connected (the container nginx, on the docker
// bridge); xff = the header as it arrives after both proxies have appended.
const ipFor = (socketAddr, xff) => proxyaddr(
  { connection: { remoteAddress: socketAddr }, socket: { remoteAddress: socketAddr },
    headers: xff ? { 'x-forwarded-for': xff } : {} },
  trust);

(async () => {
  console.log('\nRate-limit identity behind the two nginx hops\n');

  const CONTAINER_NGINX = '172.18.0.4';   // docker bridge
  const HOST_NGINX      = '127.0.0.1';    // proxy_pass to 127.0.0.1:3006

  /* 1 — the production chain resolves to the real client. */
  {
    const ip = ipFor(CONTAINER_NGINX, `49.207.200.11, ${HOST_NGINX}`);
    check('two-hop chain resolves to the real client IP', ip === '49.207.200.11', ip);
  }
  {
    // The bug: this is what `trust proxy: 1` returned for every employee.
    const ip = ipFor(CONTAINER_NGINX, `49.207.200.11, ${HOST_NGINX}`);
    check('  ...and NOT 127.0.0.1, which was one bucket for the whole company',
      ip !== '127.0.0.1', ip);
  }
  {
    const a = ipFor(CONTAINER_NGINX, `49.207.200.11, ${HOST_NGINX}`);
    const b = ipFor(CONTAINER_NGINX, `103.21.58.7, ${HOST_NGINX}`);
    check('two different employees get two different identities', a !== b, { a, b });
  }

  /* 2 — the dangerous direction: a forged header must not grant a new identity. */
  {
    const ip = ipFor(CONTAINER_NGINX, `1.2.3.4, 49.207.200.11, ${HOST_NGINX}`);
    check('a forged public X-Forwarded-For does not change who you are billed as',
      ip === '49.207.200.11', ip);
  }
  {
    // Rotating the forged value must not produce a fresh bucket each time.
    const ips = ['9.9.9.9', '8.8.8.8', '7.7.7.7']
      .map(f => ipFor(CONTAINER_NGINX, `${f}, 49.207.200.11, ${HOST_NGINX}`));
    check('  ...and rotating it still resolves to the same real client',
      new Set(ips).size === 1 && ips[0] === '49.207.200.11', ips);
  }
  {
    // A forged PRIVATE address is the subtle one: it is in a trusted range, so
    // the walk continues past it — and must still stop on the real client.
    const ip = ipFor(CONTAINER_NGINX, `10.0.0.5, 49.207.200.11, ${HOST_NGINX}`);
    check('a forged private-range hop cannot shift the identity either',
      ip === '49.207.200.11', ip);
  }

  /* 3 — the /auth/me skip depends on what req.path is INSIDE a middleware
   *     mounted at a path. If that is '/api/auth/me' rather than '/me' the
   *     skip silently never fires and the fix does nothing. */
  {
    const probe = express();
    probe.use('/api/auth', (req, res) => res.json({ path: req.path }));
    const server = probe.listen(0);
    await new Promise(r => server.once('listening', r));
    const port = server.address().port;
    const seen = await new Promise(resolve => {
      http.get({ host: '127.0.0.1', port, path: '/api/auth/me' }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => resolve(JSON.parse(d).path));
      });
    });
    server.close();
    check("req.path inside a middleware mounted at /api/auth is '/me'", seen === '/me', seen);
  }

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
