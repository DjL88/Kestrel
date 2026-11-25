import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { CollabStore } from '../src/collaboration.ts';
import { emailHashOf } from '../src/entitlement.ts';
import { newLicence } from '../src/store.ts';
import { FirestoreMailLedger, Mailer, SmtpTransport, buildMessage, secretManagerValue, type MailTransport } from '../src/mailer.ts';
import { buildOptionalServices } from '../src/wiring.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

const PASSWORD = 'abcd efgh ijkl mnop'; // a made-up app password, test only
const decodeParts = (raw: string) => [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));

test('a message is plain text and HTML, CRLF, with no way to inject a header', () => {
  const raw = buildMessage({
    from: { address: 'hello@inflight.studio', name: 'InFlight' }, to: 'kim@example.test', subject: 'Évènement\r\nBcc: victim@example.test',
    text: 'Hello\nworld', html: '<p>Hello</p>', messageIdDomain: 'inflight.studio', date: new Date(Date.UTC(2026, 10, 25, 12)),
    headers: { 'List-Unsubscribe': '<https://x/u>\r\nBcc: victim@example.test' },
  });
  const head = raw.split('\r\n\r\n')[0];
  assert.doesNotMatch(head, /^Bcc:/m, 'no injected header');
  assert.match(head, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(head, /^From: InFlight <hello@inflight\.studio>$/m);
  assert.match(head, /^Content-Type: multipart\/alternative; boundary="/m);
  assert.ok(!/[^\r]\n/.test(raw), 'every line ends in CRLF');
  assert.deepEqual(decodeParts(raw), ['Hello\nworld', '<p>Hello</p>']);
  assert.throws(() => buildMessage({ from: { address: 'hello@inflight.studio', name: 'x' }, to: 'a@b.test>\r\nRCPT TO:<c@d.test', subject: 's', text: 't', html: 'h', messageIdDomain: 'x', date: new Date() }), /invalid mail address/);
});

/** A tiny SMTP server. `startTls` in the transport is replaced by identity, so the test checks the order of the conversation. */
async function fakeSmtp(opts: { offerStartTls?: boolean; authCode?: number } = {}) {
  const seen: string[] = [];
  let data = '';
  const server = createServer((s: Socket) => {
    let inData = false; let buf = '';
    s.setEncoding('utf8');
    s.write('220 fake ESMTP\r\n');
    s.on('data', (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === '.') { inData = false; s.write('250 queued\r\n'); } else data += line + '\r\n'; continue; }
        seen.push(line);
        if (line.startsWith('EHLO')) s.write(`250-fake\r\n${opts.offerStartTls === false ? '' : '250-STARTTLS\r\n'}250 AUTH PLAIN\r\n`);
        else if (line === 'STARTTLS') s.write('220 go ahead\r\n');
        else if (line.startsWith('AUTH PLAIN')) s.write(`${opts.authCode ?? 235} ${opts.authCode ? 'bad credentials ' + line : 'ok'}\r\n`);
        else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) s.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; s.write('354 go\r\n'); }
        else if (line === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const transport = new SmtpTransport({ host: '127.0.0.1', port, username: 'david@example.test', password: async () => PASSWORD, startTls: async (s) => s, timeoutMs: 3000 });
  return { seen, data: () => data, transport, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('SMTP: STARTTLS before any credential, AUTH PLAIN, envelope, dot-stuffing', async () => {
  const f = await fakeSmtp();
  try {
    await f.transport.send('hello@inflight.studio', 'kim@example.test', 'Subject: x\r\n\r\n.starts with a dot\r\nok\r\n');
    const order = f.seen.map((l) => l.split(' ')[0]);
    assert.deepEqual(order, ['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
    const auth = Buffer.from(f.seen[3].slice('AUTH PLAIN '.length), 'base64').toString('utf8');
    assert.equal(auth, `\u0000david@example.test\u0000${PASSWORD}`);
    assert.equal(f.seen[4], 'MAIL FROM:<hello@inflight.studio>');
    assert.match(f.data(), /^\.\.starts with a dot\r\n/m, 'a line starting with a dot is stuffed');
  } finally { await f.close(); }
});

test('SMTP: no STARTTLS means no credentials are sent; a refused login never repeats the password', async () => {
  const plain = await fakeSmtp({ offerStartTls: false });
  try {
    await assert.rejects(plain.transport.send('hello@inflight.studio', 'kim@example.test', 'x\r\n'), /does not offer STARTTLS/);
    assert.ok(!plain.seen.some((l) => l.startsWith('AUTH')));
  } finally { await plain.close(); }
  const refused = await fakeSmtp({ authCode: 535 });
  try {
    await assert.rejects(refused.transport.send('hello@inflight.studio', 'kim@example.test', 'x\r\n'), (e: Error) => {
      assert.equal(e.message, 'SMTP AUTH refused (535)');
      assert.ok(!e.message.includes(Buffer.from(PASSWORD).toString('base64')) && !e.message.includes(PASSWORD));
      return true;
    });
  } finally { await refused.close(); }
});

test('the app password comes from Secret Manager once, by resource name, and is never in an error', async () => {
  let calls = 0;
  const fetcher = (async (url: string) => {
    calls++;
    assert.equal(url, 'https://secretmanager.googleapis.com/v1/projects/kestrel-hosting/secrets/kcp-smtp-hello-app-password/versions/latest:access');
    return new Response(JSON.stringify({ payload: { data: Buffer.from(PASSWORD + '\n').toString('base64') } }));
  }) as typeof fetch;
  const read = secretManagerValue('projects/kestrel-hosting/secrets/kcp-smtp-hello-app-password/versions/latest', async () => 'token', fetcher);
  assert.equal(await read(), PASSWORD);
  assert.equal(await read(), PASSWORD);
  assert.equal(calls, 1);
  assert.throws(() => secretManagerValue('kcp-smtp-hello-app-password', async () => 't'), /must be projects/);
  const denied = secretManagerValue('projects/p1-abc/secrets/s/versions/1', async () => 't', (async () => new Response('{}', { status: 403 })) as typeof fetch);
  await assert.rejects(denied(), /^Error: Secret Manager 403$/);
});

test('limits: per recipient, per sender and per day, counted in one transaction', async () => {
  const ledger = new FirestoreMailLedger(new MemoryFirestore());
  const l = { daily: 5, perSender: 4, perRecipient: 2 };
  assert.equal(await ledger.reserve('2026-11-25', 's1', 'r1', l), null);
  assert.equal(await ledger.reserve('2026-11-25', 's1', 'r1', l), null);
  assert.equal(await ledger.reserve('2026-11-25', 's1', 'r1', l), 'recipient-limit');
  assert.equal(await ledger.reserve('2026-11-25', 's1', 'r2', l), null);
  assert.equal(await ledger.reserve('2026-11-25', 's1', 'r3', l), null);
  assert.equal(await ledger.reserve('2026-11-25', 's1', 'r4', l), 'sender-limit');
  assert.equal(await ledger.reserve('2026-11-25', 's2', 'r5', l), null);
  assert.equal(await ledger.reserve('2026-11-25', 's3', 'r6', l), 'daily-limit');
  assert.equal(await ledger.reserve('2026-11-26', 's3', 'r6', l), null, 'a new day starts again');
  assert.throws(() => new Mailer({ transport: { send: async () => undefined }, ledger, fromAddress: 'hello@inflight.studio', siteOrigin: 'https://inflight.studio', unsubscribeKey: Buffer.alloc(32), limits: { daily: 1600, perSender: 1, perRecipient: 1 } }), /cannot exceed 1500/);
});

function recorder() {
  const sent: { from: string; to: string; raw: string }[] = [];
  const transport: MailTransport = { send: async (from, to, raw) => { sent.push({ from, to, raw }); } };
  return { sent, transport };
}

async function collabHarness(mailer?: Mailer) {
  const h = await startHarness(undefined, undefined, { requireAdminSwitch: true, collab: new CollabStore(new MemoryFirestore()), mailer });
  await h.app.store.setSetting('switch_collaboration', '1');
  const id = await h.app.createAccount('owner@example.test', 'a-long-password-123', 'user');
  await h.app.store.insertLicence(newLicence(`lic-${id}`, 'subscriber', h.clock.now, { accountId: id }));
  const token = (await h.app.issueSession(id, 'user')).accessToken;
  const created = await h.call('POST', '/v1/collab/projects', { token, body: { name: 'Kites <b>', displayName: 'Dave' } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const invite = (email: string, language?: string) => h.call('POST', `/v1/collab/projects/${created.body.projectId}/members`, { token, body: { kind: 'inviteEmail', email, role: 'editor', displayName: 'Kim', ...(language ? { language } : {}) } });
  return { h, invite };
}

test('an invitation is emailed only with the mailer set up AND the email switch on; the invitation stands either way', async () => {
  const none = await collabHarness();
  try {
    const r = await none.invite('kim@example.test');
    assert.equal(r.status, 200); assert.equal(r.body.emailed, undefined);
    const sw = (await none.h.call('GET', '/v1/admin/switches', { token: none.h.adminToken })).body.switches.find((s: any) => s.key === 'email');
    assert.equal(sw.configured, false); assert.equal(sw.on, false);
  } finally { await none.h.close(); }

  const { sent, transport } = recorder();
  const mailer = new Mailer({ transport, ledger: new FirestoreMailLedger(new MemoryFirestore()), fromAddress: 'hello@inflight.studio', siteOrigin: 'https://inflight.studio', unsubscribeKey: Buffer.alloc(32, 7) });
  const { h, invite } = await collabHarness(mailer);
  try {
    assert.equal((await invite('kim@example.test')).body.emailed, undefined, 'switch off in production: nothing sent');
    assert.equal(sent.length, 0);
    assert.equal((await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key: 'email', on: true } })).status, 200);
    const r = await invite('lee@example.test');
    assert.equal(r.status, 200); assert.equal(r.body.emailed, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].from, 'hello@inflight.studio'); assert.equal(sent[0].to, 'lee@example.test');
    const head = sent[0].raw.split('\r\n\r\n')[0];
    assert.match(head, /^List-Unsubscribe: <https:\/\/inflight\.studio\/v1\/mail\/unsubscribe\?r=[0-9a-f]{64}&t=[A-Za-z0-9_-]+&l=en-GB>, <mailto:hello@inflight\.studio\?subject=unsubscribe>$/m);
    assert.match(head, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
    const [text, html] = decodeParts(sent[0].raw);
    assert.match(text, /Dave has invited you to the InFlight project “Kites <b>” as an editor\./);
    assert.match(html, /Kites &lt;b&gt;/, 'HTML is escaped');
    assert.ok(!JSON.stringify((await h.call('GET', '/v1/admin/audit', { token: h.adminToken })).body).includes('lee@example.test'), 'the address is not in the audit log');

    // Unsubscribe: the link shows a button (GET changes nothing); the one-click POST stops further mail.
    const link = head.match(/<(https:\/\/inflight\.studio\/v1\/mail\/unsubscribe\?[^>]+)>/)![1].replace('https://inflight.studio', '');
    const page = await fetch(h.url + link);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /<form method="post"/);
    assert.equal((await fetch(h.url + link.replace(/t=[^&]+/, 't=forged'), { method: 'POST' })).status, 400);
    const done = await fetch(h.url + link, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    assert.equal(done.status, 200);
    await invite('lee@example.test').then((x) => assert.equal(x.body.emailed, false));
    assert.equal(sent.length, 1, 'never mailed again');
    assert.ok(JSON.stringify((await h.call('GET', '/v1/admin/audit', { token: h.adminToken })).body).includes('unsubscribed'));

    // In the recipient's language (the inviter's app language): French words, subject and unsubscribe page.
    const fr = await invite('anne@example.test', 'fr');
    assert.equal(fr.body.emailed, true);
    const frRaw = sent.at(-1)!.raw;
    const [frText, frHtml] = decodeParts(frRaw);
    assert.match(frText, /Dave vous invite au projet InFlight « Kites <b> » en tant qu’éditeur\./);
    assert.match(frHtml, /<html lang="fr">/);
    const frSubject = frRaw.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=/m)![1];
    assert.equal(Buffer.from(frSubject, 'base64').toString('utf8'), 'Dave vous invite à « Kites <b> » sur InFlight');
    const frLink = frRaw.match(/<(https:\/\/inflight\.studio\/v1\/mail\/unsubscribe\?[^>]+)>/)![1].replace('https://inflight.studio', '');
    assert.match(await (await fetch(h.url + frLink)).text(), /Ne plus recevoir d’invitations/);
    assert.equal((await invite('x@example.test', 'xx')).status, 400, 'an unknown language is refused');

    // The daily counter for /admin, against our cap and the Workspace limit.
    const today = (await h.call('GET', '/v1/admin/mail', { token: h.adminToken })).body;
    assert.equal(today.on, true); assert.equal(today.sent, 2); assert.equal(today.cap, 500); assert.equal(today.workspaceLimit, 2000); assert.equal(today.warn, false);
  } finally { await h.close(); }
});

test('the daily counter warns at 80% of the cap', async () => {
  const ledger = new FirestoreMailLedger(new MemoryFirestore());
  const mailer = new Mailer({ transport: { send: async () => undefined }, ledger, fromAddress: 'hello@inflight.studio', siteOrigin: 'https://inflight.studio', unsubscribeKey: Buffer.alloc(32), limits: { daily: 10, perSender: 100, perRecipient: 100 }, now: () => Date.UTC(2026, 10, 25, 12) });
  const send = (i: number) => mailer.sendInvitation({ to: `p${i}@example.test`, recipientHash: emailHashOf(`p${i}@example.test`), senderAccountId: 's', inviterName: 'Dave', projectName: 'P', role: 'viewer' });
  for (let i = 0; i < 7; i++) await send(i);
  assert.equal((await mailer.today()).warn, false);
  await send(8);
  assert.deepEqual(await mailer.today(), { day: '2026-11-25', sent: 8, cap: 10, workspaceLimit: 2000, warn: true });
});

test('wiring: off without KCP_MAIL_ENABLED; with it, every required setting is checked and no password is read from the environment', async () => {
  const db = new MemoryFirestore();
  assert.equal((await buildOptionalServices({ firestore: db, env: {}, sessionSecret: Buffer.alloc(32) })).mailer, undefined);
  await assert.rejects(buildOptionalServices({ firestore: db, env: { KCP_MAIL_ENABLED: '1', KCP_SITE_ORIGIN: 'https://inflight.studio', KCP_SMTP_PASSWORD_SECRET: 'projects/kestrel-hosting/secrets/kcp-smtp-hello-app-password/versions/latest' }, sessionSecret: Buffer.alloc(32) }), /KCP_SMTP_USER is required/);
  const on = await buildOptionalServices({ firestore: db, sessionSecret: Buffer.alloc(32), env: {
    KCP_MAIL_ENABLED: '1', KCP_SITE_ORIGIN: 'https://inflight.studio', KCP_SMTP_USER: 'david@example.test',
    KCP_SMTP_PASSWORD_SECRET: 'projects/kestrel-hosting/secrets/kcp-smtp-hello-app-password/versions/latest',
  } });
  assert.ok(on.mailer); assert.ok(on.enabled.includes('email'));
  assert.deepEqual(on.mailer!.limits, { daily: 500, perSender: 30, perRecipient: 3 });
  const token = on.mailer!.unsubscribeToken(emailHashOf('a@b.test'));
  assert.ok(on.mailer!.checkUnsubscribe(emailHashOf('a@b.test'), token));
  assert.ok(!on.mailer!.checkUnsubscribe(emailHashOf('c@d.test'), token));
});
