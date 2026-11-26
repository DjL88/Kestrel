/**
 * "FCM first, email only as fallback" (owner, 25 Nov 2026): the verified Firebase address book, the notice fallback, the
 * product news broadcast with its opt-in email, and the Gmail-aware daily cap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { emailHashOf } from '../src/entitlement.ts';
import { FirestoreMailLedger, Mailer, fromAddressFor, mailAccountKind, mailNoticeDelivery, type MailTransport } from '../src/mailer.ts';
import { NoticeContacts, identityToolkitLookup, type FirebaseUserLookup } from '../src/noticeContacts.ts';
import { NoticeStore } from '../src/notices.ts';
import { NewsBroadcaster } from '../src/news.ts';
import { PushService, noticeDelivery, type PushMessage, type SendResult } from '../src/push.ts';
import { buildOptionalServices } from '../src/wiring.ts';
import { firebaseIssuer } from '../src/oidcIdToken.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness, type Harness } from './helpers.ts';

const TOKEN = (n: number) => `fcm-token-${String(n).padStart(20, 'x')}:APA91b`;
const SECRET = 'projects/kestrel-hosting/secrets/kcp-smtp-hello-app-password/versions/latest';

function fakeFcm() {
  const sent: { token: string; message: PushMessage }[] = [];
  const failing = new Set<string>();
  return { sent, failing, sender: { send: async (token: string, message: PushMessage): Promise<SendResult> => { if (failing.has(token)) return 'error'; sent.push({ token, message }); return 'ok'; } } };
}
function recorder() {
  const sent: { from: string; to: string; raw: string }[] = [];
  const transport: MailTransport = { send: async (from, to, raw) => { sent.push({ from, to, raw }); } };
  return { sent, transport };
}
const decodeText = (raw: string) => Buffer.from(raw.split('Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');

/** A Firebase Auth stand-in: uid → user. */
function users(map: Record<string, { email: string; emailVerified: boolean }>): FirebaseUserLookup & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (uid: string) => { calls.push(uid); return map[uid]; }) as FirebaseUserLookup & { calls: string[] };
  f.calls = calls;
  return f;
}

// ---- Gap 3: the cap follows the sending account ------------------------------------------------------------------

test('a gmail.com SMTP login is personal Gmail: hard cap 450 a day, From is the Gmail address unless an alias is set', async () => {
  assert.equal(mailAccountKind('dave.example@gmail.com'), 'gmail');
  assert.equal(mailAccountKind('Dave@GoogleMail.com'), 'gmail');
  assert.equal(mailAccountKind('hello@inflight.studio'), 'workspace');
  assert.equal(fromAddressFor('dave.example@gmail.com'), 'dave.example@gmail.com');
  assert.equal(fromAddressFor('dave.example@gmail.com', 'hello@inflight.studio'), 'hello@inflight.studio', 'a verified Send mail as alias wins');
  assert.equal(fromAddressFor('ops@inflight.studio'), 'hello@inflight.studio');

  const db = new MemoryFirestore();
  const env = { KCP_MAIL_ENABLED: '1', KCP_SITE_ORIGIN: 'https://inflight.studio', KCP_SMTP_USER: 'dave.example@gmail.com', KCP_SMTP_PASSWORD_SECRET: SECRET };
  const { sent, transport } = recorder();
  const gmail = (await buildOptionalServices({ firestore: db, env, sessionSecret: Buffer.alloc(32), mailTransport: transport })).mailer!;
  assert.equal(gmail.account, 'gmail');
  assert.deepEqual(gmail.limits, { daily: 450, perSender: 30, perRecipient: 3 });
  const today = await gmail.today();
  assert.equal(today.cap, 450); assert.equal(today.providerLimit, 500); assert.equal(today.account, 'gmail'); assert.equal(today.from, 'dave.example@gmail.com');
  await gmail.sendInvitation({ to: 'kim@example.test', recipientHash: emailHashOf('kim@example.test'), senderAccountId: 's', inviterName: 'Dave', projectName: 'P', role: 'viewer' });
  assert.equal(sent[0].from, 'dave.example@gmail.com');
  assert.match(sent[0].raw, /^From: InFlight <dave\.example@gmail\.com>$/m);

  await assert.rejects(buildOptionalServices({ firestore: db, env: { ...env, KCP_MAIL_DAILY_LIMIT: '500' }, sessionSecret: Buffer.alloc(32) }), /KCP_MAIL_DAILY_LIMIT must be a whole number from 0 to 450/);
  assert.throws(() => new Mailer({ transport, ledger: new FirestoreMailLedger(db), fromAddress: 'a@gmail.com', account: 'gmail', siteOrigin: 'https://inflight.studio', unsubscribeKey: Buffer.alloc(32), limits: { daily: 451, perSender: 1, perRecipient: 1 } }), /cannot exceed 450 on a Gmail account/);
  const alias = (await buildOptionalServices({ firestore: db, env: { ...env, KCP_MAIL_FROM: 'hello@inflight.studio' }, sessionSecret: Buffer.alloc(32), mailTransport: transport })).mailer!;
  assert.equal((await alias.today()).from, 'hello@inflight.studio');

  const workspace = (await buildOptionalServices({ firestore: db, env: { ...env, KCP_SMTP_USER: 'ops@inflight.studio' }, sessionSecret: Buffer.alloc(32), mailTransport: transport })).mailer!;
  assert.equal(workspace.account, 'workspace'); assert.equal(workspace.limits.daily, 500);
  const w = await workspace.today();
  assert.equal(w.providerLimit, 2000); assert.equal(w.from, 'hello@inflight.studio');
});

test('the Gmail cap is enforced by the shared daily counter', async () => {
  const ledger = new FirestoreMailLedger(new MemoryFirestore());
  const { sent, transport } = recorder();
  const mailer = new Mailer({ transport, ledger, fromAddress: 'a@gmail.com', account: 'gmail', siteOrigin: 'https://inflight.studio', unsubscribeKey: Buffer.alloc(32), limits: { daily: 450, perSender: 1000, perRecipient: 1000 }, now: () => Date.UTC(2026, 10, 25, 9) });
  for (let i = 0; i < 449; i++) await ledger.reserve('2026-11-25', 'x', `r${i}`, mailer.limits);
  assert.deepEqual(await mailer.sendNotice({ to: 'last@example.test', accountId: 'acc_1', subject: 'S', text: 'T' }), { sent: true });
  assert.deepEqual(await mailer.sendNotice({ to: 'over@example.test', accountId: 'acc_1', subject: 'S', text: 'T' }), { sent: false, reason: 'daily-limit' });
  assert.equal(sent.length, 1);
});

// ---- Gap 1: the address book -------------------------------------------------------------------------------------

test('the address book uses only a verified Firebase address that matches the one the account signed in with', async () => {
  const db = new MemoryFirestore();
  const lookup = users({
    'fb-kim': { email: 'Kim@Example.test', emailVerified: true },
    'fb-lee': { email: 'lee@example.test', emailVerified: false },
    'fb-moved': { email: 'someone-else@example.test', emailVerified: true },
  });
  const contacts = new NoticeContacts(db, lookup);
  await contacts.rememberSignIn('acc_kim', 'fb-kim', emailHashOf('kim@example.test'));
  await contacts.setLanguage('acc_kim', 'de');
  await contacts.rememberSignIn('acc_lee', 'fb-lee', emailHashOf('lee@example.test'));
  await contacts.rememberSignIn('acc_moved', 'fb-moved', emailHashOf('moved@example.test'));
  assert.deepEqual(await contacts.addressBook('acc_kim'), { address: 'Kim@Example.test', language: 'de' });
  assert.equal(await contacts.addressBook('acc_lee'), undefined, 'unverified: never used');
  assert.equal(await contacts.addressBook('acc_moved'), undefined, 'not the address this account signed in with');
  assert.equal(await contacts.addressBook('acc_never'), undefined, 'never signed in through the app');
  assert.equal(await new NoticeContacts(db, undefined).addressBook('acc_kim'), undefined, 'no lookup configured');
  const failing = new NoticeContacts(db, async () => { throw new Error('network'); });
  assert.equal(await failing.addressBook('acc_kim'), undefined);
  // Nothing but the id and the hash is stored.
  const stored = JSON.stringify((await db.collection('notify_contacts').doc('acc_kim').get()).data());
  assert.ok(!/@/.test(stored), stored);
  assert.match(stored, /"firebaseUid":"fb-kim"/);
});

test('Identity Toolkit lookup: the service identity, the project, verified flag passed through, failures are no user', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const answer = (status: number, body: unknown) => (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  const ok = identityToolkitLookup('kestrel-hosting', async () => 'tok', answer(200, { users: [{ localId: 'fb-1', email: 'a@b.test', emailVerified: true }] }));
  assert.deepEqual(await ok('fb-1'), { email: 'a@b.test', emailVerified: true });
  assert.equal(seen[0].url, 'https://identitytoolkit.googleapis.com/v1/projects/kestrel-hosting/accounts:lookup');
  assert.equal((seen[0].init.headers as Record<string, string>).authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { localId: ['fb-1'] });
  assert.equal(await ok('bad uid/../'), undefined);
  const logs: string[] = [];
  assert.equal(await identityToolkitLookup('kestrel-hosting', async () => 'tok', answer(403, { error: { message: 'a@b.test' } }), (m) => logs.push(m))('fb-1'), undefined);
  assert.ok(logs.every((l) => !l.includes('@')));
  assert.deepEqual(await identityToolkitLookup('kestrel-hosting', async () => 'tok', answer(200, { users: [{ localId: 'fb-1', email: 'a@b.test' }] }))('fb-1'), { email: 'a@b.test', emailVerified: false });
  assert.throws(() => identityToolkitLookup('Not A Project', async () => 'tok'), /Firebase project id/);
});

test('app sign-in records the Firebase user (id and hash only) for the address book', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(pair.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'fb1', alg: 'RS256' } as JsonWebKey;
  const db = new MemoryFirestore();
  const contacts = new NoticeContacts(db, users({ 'fb-user-1': { email: 'cleo@example.com', emailVerified: true } }));
  const h = await startHarness(undefined, undefined, { env: { KCP_FIREBASE_PROJECT_ID: 'kestrel-test-project' }, firebaseKeys: async () => [jwk], contacts });
  try {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const head = b64({ alg: 'RS256', kid: 'fb1' });
    const body = b64({ iss: firebaseIssuer('kestrel-test-project'), aud: 'kestrel-test-project', sub: 'fb-user-1', email: 'cleo@example.com', email_verified: true, iat: Math.floor(h.clock.now / 1000), exp: Math.floor(h.clock.now / 1000) + 600 });
    const credential = `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), pair.privateKey).toString('base64url')}`;
    const signIn = await h.call('POST', '/v1/auth/firebase', { body: { credential } });
    assert.equal(signIn.status, 200);
    const accounts = (await db.collection('notify_contacts').get()).docs;
    assert.equal(accounts.length, 1);
    assert.deepEqual(await contacts.addressBook(accounts[0].id), { address: 'cleo@example.com' });
    // The app tells the server its language; product news by email starts off and is audited when changed.
    const token = signIn.body.accessToken as string;
    assert.deepEqual((await h.call('GET', '/v1/notify/email', { token })).body, { available: false, productNews: false, productEmail: true, productEmailAvailable: false });
    assert.equal((await h.call('POST', '/v1/notify/email', { token, body: { language: 'fr' } })).body.productNews, false);
    assert.deepEqual(await contacts.addressBook(accounts[0].id), { address: 'cleo@example.com', language: 'fr' });
    assert.equal((await h.call('POST', '/v1/notify/email', { token, body: { productNews: true } })).body.productNews, true);
    assert.deepEqual(await contacts.productNewsAccounts(), [accounts[0].id]);
    assert.equal((await h.call('POST', '/v1/notify/email', { token, body: { language: 'xx' } })).status, 400);
    assert.equal((await h.call('POST', '/v1/notify/email', { token, body: { productNews: false } })).body.productNews, false);
    assert.deepEqual(await contacts.productNewsAccounts(), []);
  } finally { await h.close(); }
});

// ---- Gap 1: the notice fallback ----------------------------------------------------------------------------------

test('a notice is emailed only when push reached no device; never when the kind is off or the push was sent', async () => {
  const db = new MemoryFirestore();
  const fcm = fakeFcm();
  const push = new PushService(db, fcm.sender);
  const { sent, transport } = recorder();
  const mailer = new Mailer({ transport, ledger: new FirestoreMailLedger(db), fromAddress: 'a@gmail.com', account: 'gmail', siteOrigin: 'https://inflight.studio', unsubscribeKey: Buffer.alloc(32, 1) });
  const contacts = new NoticeContacts(db, users({
    'fb-a': { email: 'a@example.test', emailVerified: true }, 'fb-b': { email: 'b@example.test', emailVerified: true },
    'fb-c': { email: 'c@example.test', emailVerified: true }, 'fb-d': { email: 'd@example.test', emailVerified: true },
    'fb-e': { email: 'e@example.test', emailVerified: false },
  }));
  for (const x of ['a', 'b', 'c', 'd', 'e']) await contacts.rememberSignIn(`acc_${x}`, `fb-${x}`, emailHashOf(`${x}@example.test`));
  await push.register('acc_a', TOKEN(1), 'web', 1);                   // a: a device that takes the push
  await push.setPreferences('acc_b', { comments: false });            // b: switched comments off
  await push.register('acc_c', TOKEN(2), 'web', 1); fcm.failing.add(TOKEN(2)); // c: FCM fails to reach them
  // d: no device at all; e: no device and an unverified address.
  const notices = new NoticeStore(db, noticeDelivery(push, mailNoticeDelivery(mailer, contacts.addressBook).email));
  const counts = await notices.deliver({ kind: 'comment', projectId: 'p1', projectName: 'Kites', photoId: 'k1', actorName: 'Erin', recipients: ['acc_a', 'acc_b', 'acc_c', 'acc_d', 'acc_e'] }, Date.UTC(2026, 10, 25, 12));
  assert.deepEqual(counts, { inbox: 5, push: 1, email: 2 });
  assert.deepEqual(fcm.sent.map((s) => s.token), [TOKEN(1)]);
  assert.deepEqual(sent.map((m) => m.to).sort(), ['c@example.test', 'd@example.test'], 'only where FCM is unavailable or failed, and only verified');
  assert.match(decodeText(sent[0].raw), /Erin commented on a photo/);
  assert.match(sent[0].raw, /unsubscribe\?s=notice&a=acc_[cd]&t=/, 'a notice email links to stopping product emails only');

  // Product emails switched off (Communication preferences): the inbox still has it, nothing is emailed.
  await contacts.setProductEmail('acc_d', false);
  const off = new NoticeStore(db, noticeDelivery(push, mailNoticeDelivery(mailer, contacts.addressBook, contacts.wantsNoticeEmail).email));
  const again = await off.deliver({ kind: 'comment', projectId: 'p2', projectName: 'Owls', photoId: 'o1', actorName: 'Erin', recipients: ['acc_c', 'acc_d'] }, Date.UTC(2026, 10, 25, 13));
  assert.equal(again.inbox, 2);
  assert.deepEqual(sent.slice(2).map((m) => m.to), ['c@example.test'], 'acc_d turned product emails off');
});

// ---- Gap 2: product news -----------------------------------------------------------------------------------------

async function newsSetup(dailyCap = 450) {
  const db = new MemoryFirestore();
  const fcm = fakeFcm();
  const push = new PushService(db, fcm.sender);
  const { sent, transport } = recorder();
  const ref = { clock: { now: Date.UTC(2026, 10, 18, 12) } };
  const mailer = new Mailer({ transport, ledger: new FirestoreMailLedger(db), fromAddress: 'a@gmail.com', account: 'gmail', siteOrigin: 'https://inflight.studio', unsubscribeKey: Buffer.alloc(32, 2), limits: { daily: dailyCap, perSender: 30, perRecipient: 3 }, now: () => ref.clock.now });
  const contacts = new NoticeContacts(db, users(Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => [`fb-${x}`, { email: `${x}@example.test`, emailVerified: true }]))));
  for (const x of ['a', 'b', 'c', 'd', 'e', 'f']) await contacts.rememberSignIn(`acc_${x}`, `fb-${x}`, emailHashOf(`${x}@example.test`));
  const news = new NewsBroadcaster(db, { push, mailer, contacts, addressBook: contacts.addressBook, newId: () => 'news-0001' });
  const h = await startHarness(undefined, undefined, { push, mailer, contacts, news, requireAdminSwitch: true });
  ref.clock = h.clock;
  /** A new admin session at the harness's current time (sessions last 15 minutes). */
  const admin = async () => { const id = (await h.app.store.findAccountByEmailHash((await import('../src/crypto.ts')).sha256Hex('admin@example.test')))?.accountId; return id ? (await h.app.issueSession(id, 'admin')).accessToken : h.adminToken; };
  return { db, fcm, push, sent, mailer, contacts, news, h, admin };
}

test('product news: push first; email only to people who opted in and could not be pushed; off means nothing', async () => {
  const { fcm, push, sent, contacts, h } = await newsSetup();
  try {
    await push.register('acc_a', TOKEN(1), 'web', 1);                                   // a: device → push
    await push.register('acc_b', TOKEN(2), 'web', 1); await push.setPreferences('acc_b', { news: false }); // b: news off
    await contacts.setProductNews('acc_c', true, 1);                                     // c: no device, opted in → email
    await contacts.setProductNews('acc_d', true, 1); await contacts.setLanguage('acc_d', 'cy'); await push.register('acc_d', TOKEN(3), 'web', 1); fcm.failing.add(TOKEN(3)); // d: push fails, opted in → email
    await push.register('acc_e', TOKEN(4), 'web', 1); fcm.failing.add(TOKEN(4));       // e: push fails, NOT opted in → nothing
    // f: signed in, no device, no opt-in → not in the audience at all.
    const send = (body: object) => h.call('POST', '/v1/admin/news/send', { token: h.adminToken, body });
    const words = { title: 'New: lens corrections', body: 'Lens corrections now work offline.' };

    assert.equal((await h.call('POST', '/v1/admin/news/send', { token: (await h.app.issueSession(await h.app.createAccount('u@example.test', 'a-long-password-123', 'user'), 'user')).accessToken, body: { ...words, dryRun: true } })).status, 403);
    assert.equal((await send({ ...words, dryRun: false })).status, 409, 'off until the product-news switch is on');
    const sw = (await h.call('GET', '/v1/admin/switches', { token: h.adminToken })).body.switches.find((s: { key: string }) => s.key === 'product-news');
    assert.equal(sw.on, false); assert.equal(sw.configured, true);
    for (const key of ['product-news', 'push', 'email']) assert.equal((await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key, on: true } })).status, 200);

    const dry = (await send({ ...words, dryRun: true })).body;
    assert.equal(dry.dryRun, true); assert.equal(dry.audience, 5); assert.equal(dry.off, 1);
    assert.equal(fcm.sent.length, 0); assert.equal(sent.length, 0, 'a dry run sends nothing');

    const r = (await send({ ...words, dryRun: false })).body;
    assert.deepEqual({ audience: r.audience, pushed: r.pushed, emailed: r.emailed, off: r.off, unreachable: r.unreachable, emailWaiting: r.emailWaiting }, { audience: 5, pushed: 1, emailed: 2, off: 1, unreachable: 1, emailWaiting: 0 });
    assert.deepEqual(fcm.sent.map((s) => s.token), [TOKEN(1)]);
    assert.equal(fcm.sent[0].message.data.kind, 'news');
    assert.deepEqual(sent.map((m) => m.to).sort(), ['c@example.test', 'd@example.test']);
    const welsh = sent.find((m) => m.to === 'd@example.test')!;
    assert.match(welsh.raw, /^List-Unsubscribe: <https:\/\/inflight\.studio\/v1\/mail\/unsubscribe\?s=news&a=acc_d&t=[A-Za-z0-9_-]+&l=cy>, <mailto:a@gmail\.com\?subject=unsubscribe>$/m);
    assert.match(welsh.raw, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
    assert.match(decodeText(welsh.raw), /Lens corrections now work offline\.[\s\S]*newyddion InFlight drwy e-bost/);
    const audit = JSON.stringify((await h.call('GET', '/v1/admin/audit', { token: h.adminToken })).body);
    assert.ok(!audit.includes('@example.test'), 'no address in the audit log');

    // The news link stops news for that account only, and the app's switch shows it (and can turn it back on).
    const link = welsh.raw.match(/<(https:\/\/inflight\.studio\/v1\/mail\/unsubscribe\?[^>]+)>/)![1].replace('https://inflight.studio', '');
    const page = await fetch(h.url + link);
    assert.equal(page.status, 200); assert.match(await page.text(), /<form method="post" action="\/v1\/mail\/unsubscribe\?s=news&amp;a=acc_d/);
    assert.equal((await contacts.preferences('acc_d')).productNews, true, 'the link only shows a button');
    assert.equal((await fetch(h.url + link, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' })).status, 200);
    assert.deepEqual(await contacts.preferences('acc_d'), { productNews: false, productEmail: true, language: 'cy' }, 'news off; product emails untouched');
    assert.equal((await fetch(h.url + link.replace(/t=[^&]+/, 't=forged'), { method: 'POST' })).status, 400);
    assert.equal((await fetch(h.url + link.replace('a=acc_d', 'a=acc_c'), { method: 'POST' })).status, 400, 'a link cannot be moved to another account');

    // Sending the same news again reaches nobody twice.
    const again = (await send({ ...words, broadcastId: r.broadcastId, dryRun: false })).body;
    assert.equal(again.alreadyReached, 4); assert.equal(fcm.sent.length, 1); assert.equal(sent.length, 2);
  } finally { await h.close(); }
});

test('product news over the day\'s email cap stops emailing, reports who is waiting, and the same id finishes the next day', async () => {
  const { contacts, sent, h, admin } = await newsSetup(2);
  try {
    for (const x of ['a', 'b', 'c', 'd']) await contacts.setProductNews(`acc_${x}`, true, 1);
    for (const key of ['product-news', 'push', 'email']) await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key, on: true } });
    const words = { title: 'News', body: 'Something new.' };
    const first = (await h.call('POST', '/v1/admin/news/send', { token: h.adminToken, body: { ...words, dryRun: false } })).body;
    assert.equal(first.emailed, 2); assert.equal(first.emailWaiting, 2); assert.equal(first.emailLimitReached, true);
    assert.equal(sent.length, 2);
    h.clock.now += 24 * 3600_000;
    const next = (await h.call('POST', '/v1/admin/news/send', { token: await admin(), body: { title: 'Changed words are ignored', body: 'x', broadcastId: first.broadcastId, dryRun: false } })).body;
    assert.equal(next.alreadyReached, 2); assert.equal(next.emailed, 2); assert.equal(next.emailWaiting, 0); assert.equal(next.emailLimitReached, false);
    assert.equal(new Set(sent.map((m) => m.to)).size, 4, 'each person once');
    assert.equal(sent[3].raw.includes('Changed words'), false, 'a resumed broadcast keeps its first words');
  } finally { await h.close(); }
});

test('product news email is never sent without the opt-in or with the email switch off', async () => {
  const { contacts, sent, h } = await newsSetup();
  try {
    await contacts.setProductNews('acc_a', true, 1);
    for (const key of ['product-news', 'push']) await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key, on: true } });
    const r = (await h.call('POST', '/v1/admin/news/send', { token: h.adminToken, body: { title: 'T', body: 'B', dryRun: false } })).body;
    assert.equal(r.audience, 1); assert.equal(r.emailed, 0); assert.equal(r.unreachable, 1);
    assert.equal(sent.length, 0);
  } finally { await h.close(); }
});

test('wiring: contacts and news are built with collaboration; the Firebase lookup only with email and a project id', async () => {
  const db = new MemoryFirestore();
  const base = { KCP_COLLABORATION_ENABLED: '1' };
  const plain = await buildOptionalServices({ firestore: db, env: base, sessionSecret: Buffer.alloc(32) });
  assert.ok(plain.contacts); assert.equal(plain.news, undefined, 'no push, no news');
  assert.equal(await plain.contacts!.addressBook('acc_x'), undefined);
  const full = await buildOptionalServices({ firestore: db, sessionSecret: Buffer.alloc(32), pushSender: fakeFcm().sender, token: async () => 't', env: {
    ...base, KCP_PUSH_ENABLED: '1', KCP_FCM_PROJECT_ID: 'kestrel-hosting', KCP_FIREBASE_PROJECT_ID: 'kestrel-hosting',
    KCP_MAIL_ENABLED: '1', KCP_SITE_ORIGIN: 'https://inflight.studio', KCP_SMTP_USER: 'dave.example@gmail.com', KCP_SMTP_PASSWORD_SECRET: SECRET,
  } });
  assert.ok(full.news); assert.ok(full.enabled.includes('product-news'));
});

export type { Harness };
