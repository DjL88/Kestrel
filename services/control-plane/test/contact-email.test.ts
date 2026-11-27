import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreMailLedger, Mailer, contactAlertMail, safeReplyTo, type MailTransport } from '../src/mailer.ts';
import { needsYou } from '../../../site/assets/admin-needs.mjs';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

const OWNER = 'dave@example.test';
const decode = (raw: string) => [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((m) => Buffer.from(m[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8'));

function mailerWith(transport: MailTransport, daily = 500) {
  return new Mailer({ transport, ledger: new FirestoreMailLedger(new MemoryFirestore()), fromAddress: 'hello@inflight.studio', siteOrigin: 'https://inflight.studio', unsubscribeKey: Buffer.alloc(32, 7), limits: { daily, perSender: 30, perRecipient: 3 } });
}
async function harness(opts: { transport?: MailTransport; contactNotify?: boolean; daily?: number } = {}) {
  const sent: { to: string; raw: string }[] = [];
  const transport = opts.transport ?? { send: async (_from: string, to: string, raw: string) => { sent.push({ to, raw }); } };
  const h = await startHarness(undefined, undefined, {
    requireAdminSwitch: true, mailer: mailerWith(transport, opts.daily),
    ...(opts.contactNotify === false ? {} : { appDeps: { contactNotify: { to: OWNER } } }),
  });
  const post = (body: object) => h.call('POST', '/v1/contact', { body: { consent: true, ...body }, headers: { 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) } });
  return { h, sent, post };
}

test('a contact message is stored and emailed to the owner, plain text, Reply-To the sender, without the user-email switch', async () => {
  const { h, sent, post } = await harness();
  try {
    assert.equal((await post({ name: 'Alex Kite', email: 'alex@example.test', message: 'Hello <b>there</b>\nSecond line' })).status, 200);
    assert.equal(sent.length, 1, 'on by default once contact_notify_to is set, even though the email switch is off');
    assert.equal(sent[0]!.to, OWNER);
    const head = sent[0]!.raw.split('\r\n\r\n')[0]!;
    assert.match(head, /^Subject: InFlight contact: Alex Kite$/m);
    assert.match(head, /^Reply-To: <alex@example\.test>$/m);
    assert.match(head, /^From: InFlight <hello@inflight\.studio>$/m);
    const [text, html] = decode(sent[0]!.raw);
    assert.match(text!, /Name: Alex Kite\r\nEmail: alex@example\.test/);
    assert.match(text!, /Hello <b>there<\/b>\r\nSecond line/, 'the text part is the message as written');
    assert.match(html!, /Hello &lt;b&gt;there&lt;\/b&gt;/, 'nothing from the sender is ever HTML');
    const messages = (await h.call('GET', '/v1/admin/messages', { token: h.adminToken })).body.messages;
    assert.equal(messages.length, 1, 'still kept in /admin, Messages');
  } finally { await h.close(); }
});

test('no email when contact_notify_to is not set, or the owner turned "Email me contact form messages" off', async () => {
  const none = await harness({ contactNotify: false });
  try {
    assert.equal((await none.post({ name: 'Sam', email: 'sam@example.test', message: 'Hi' })).status, 200);
    assert.equal(none.sent.length, 0);
    const sw = (await none.h.call('GET', '/v1/admin/switches', { token: none.h.adminToken })).body.switches.find((s: { key: string }) => s.key === 'contact-email');
    assert.equal(sw.configured, false);
  } finally { await none.h.close(); }
  const off = await harness();
  try {
    assert.equal((await off.h.call('POST', '/v1/admin/switches/set', { token: off.h.adminToken, body: { key: 'contact-email', on: false } })).status, 200);
    await off.post({ name: 'Sam', email: 'sam@example.test', message: 'Hi' });
    assert.equal(off.sent.length, 0);
  } finally { await off.h.close(); }
});

test('header injection through the name or the address is refused or flattened', () => {
  assert.equal(safeReplyTo('alex@example.test'), 'alex@example.test');
  for (const bad of ['alex@example.test\r\nBcc: victim@example.test', 'a@b.test, c@d.test', '<a@b.test>', 'a b@c.test', 'not-an-address']) assert.equal(safeReplyTo(bad), undefined, bad);
  const mail = contactAlertMail({ name: 'Eve\r\nBcc: victim@example.test', email: 'eve@example.test\nBcc: x@y.test', message: 'm', messageId: 'msg_1' }, new Date(0));
  assert.doesNotMatch(mail.subject, /[\r\n]/);
  assert.equal(mail.replyTo, undefined, 'no Reply-To from a bad address');
  assert.doesNotMatch(mail.text.split('\nMessage:')[0]!, /\nBcc:/, 'the name and address lines stay one line each');
});

test('the route keeps an injected name out of the headers', async () => {
  const { h, sent, post } = await harness();
  try {
    // The form's own validation refuses a bad address before anything is stored or sent.
    assert.equal((await post({ name: 'Eve', email: 'eve@example.test\r\nBcc: victim@example.test', message: 'Hi' })).status, 400);
    assert.equal((await post({ name: 'Eve\r\nBcc: victim@example.test', email: 'eve@example.test', message: 'Hi' })).status, 200);
    const head = sent.at(-1)!.raw.split('\r\n\r\n')[0]!;
    assert.doesNotMatch(head, /^Bcc:/m);
  } finally { await h.close(); }
});

test('a failed send still stores the message, still tells the visitor it worked, and /admin, Today says so until one goes', async () => {
  let fail = true;
  const sent: string[] = [];
  const { h, post } = await harness({ transport: { send: async (_f, to) => { if (fail) throw new Error('SMTP timed out'); sent.push(to); } } });
  try {
    const r = await post({ name: 'Sam', email: 'sam@example.test', message: 'Hi' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { received: true });
    assert.equal((await h.call('GET', '/v1/admin/messages', { token: h.adminToken })).body.messages.length, 1);
    const overview = (await h.call('GET', '/v1/admin/overview', { token: h.adminToken })).body;
    assert.equal(overview.contactMailProblem.problem, 'sending failed');
    const needs = needsYou({ overview, messages: [], refunds: [], safety: { notices: [] } }).items;
    assert.ok(needs.some((n: { id: string }) => n.id === 'contact-mail'), 'shown on Today');
    fail = false;
    await post({ name: 'Sam', email: 'sam@example.test', message: 'Again' });
    assert.equal((await h.call('GET', '/v1/admin/overview', { token: h.adminToken })).body.contactMailProblem, null, 'cleared once a message is emailed');
  } finally { await h.close(); }
});

test('contact emails count against the daily cap, but not the 3-a-day per-recipient limit meant for invitations', async () => {
  const { h, sent, post } = await harness({ daily: 5 });
  try {
    for (let i = 0; i < 6; i++) await post({ name: 'N' + i, email: `n${i}@example.test`, message: 'Hi' });
    assert.equal(sent.length, 5, 'five go (past the per-recipient 3), the sixth waits for the daily cap');
    assert.equal((await h.call('GET', '/v1/admin/overview', { token: h.adminToken })).body.contactMailProblem.problem, 'the daily email limit was reached');
    assert.equal((await h.call('GET', '/v1/admin/messages', { token: h.adminToken })).body.messages.length, 6, 'every message is kept');
  } finally { await h.close(); }
});
