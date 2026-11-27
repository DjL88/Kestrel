/**
 * App email (share invitations, notices when push cannot reach someone, product news to people who asked for it). OFF
 * unless the `email` admin switch is on AND Terraform has set KCP_MAIL_ENABLED (smtp_mail_enabled).
 *
 * The sending account may be a Google Workspace user (From hello@inflight.studio once that is a verified "Send mail as"
 * address) or, for now, a personal Gmail account (owner, 25 Nov 2026). The account type follows the SMTP username: a
 * gmail.com / googlemail.com login is consumer Gmail, which allows about 500 recipients a day, so the hard cap is 450 and
 * From is that Gmail address itself unless KCP_MAIL_FROM names a verified "Send mail as" alias.
 *
 * - SMTP to smtp.gmail.com:587 with STARTTLS required: credentials are never sent before TLS, and a server that does
 *   not offer STARTTLS is refused.
 * - The app password is read at run time from Secret Manager (kcp-smtp-hello-app-password) and kept only in memory.
 *   It is never logged, never in an env file, never in the repository. Errors never include it.
 * - Limits well under Google's: Workspace allows about 2,000 a day (our hard cap 1,500), consumer Gmail about 500 (our
 *   hard cap 450). A daily total (default 500, or 450 on Gmail), per sender account (30) and per recipient (3), counted
 *   in Firestore transactions, so restarts and instances cannot exceed them.
 * - Every message is plain text + HTML, with List-Unsubscribe (one-click, RFC 8058, and mailto). An unsubscribed address
 *   (stored only as its email hash) is never mailed again.
 * - Addresses are not stored or logged: the ledger keeps hashes and counts only.
 */
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FirestoreLike } from './firestoreStore.ts';
import { htmlLang, mailWords } from './mailText.ts';
import { emailHashOf } from './entitlement.ts';

export const MAIL_HARD_DAILY_MAX = 1500; // Workspace allows about 2,000 a day per user; stay well under it.
/** Consumer Gmail allows about 500 recipients a day; stay under it. */
export const GMAIL_HARD_DAILY_MAX = 450;
/** Google's own daily limits, shown in /admin. */
export const WORKSPACE_DAILY_LIMIT = 2000;
export const GMAIL_DAILY_LIMIT = 500;

/** Which kind of Google account sends: a gmail.com or googlemail.com login is consumer Gmail; anything else Workspace. */
export type MailAccountKind = 'gmail' | 'workspace';
export const mailAccountKind = (smtpUsername: string): MailAccountKind => (/@(gmail|googlemail)\.com$/i.test(smtpUsername.trim()) ? 'gmail' : 'workspace');
export const hardDailyMax = (kind: MailAccountKind) => (kind === 'gmail' ? GMAIL_HARD_DAILY_MAX : MAIL_HARD_DAILY_MAX);
export const providerDailyLimit = (kind: MailAccountKind) => (kind === 'gmail' ? GMAIL_DAILY_LIMIT : WORKSPACE_DAILY_LIMIT);
/**
 * The From address. A verified "Send mail as" alias when one is configured; otherwise a personal Gmail account can only
 * send as itself, and a Workspace account sends as hello@inflight.studio (which must be its verified alias).
 */
export function fromAddressFor(smtpUsername: string, configured?: string): string {
  if (configured?.trim()) return configured.trim();
  return mailAccountKind(smtpUsername) === 'gmail' ? smtpUsername.trim() : 'hello@inflight.studio';
}

export interface MailLimits { daily: number; perSender: number; perRecipient: number }
export const DEFAULT_MAIL_LIMITS: MailLimits = { daily: 500, perSender: 30, perRecipient: 3 };

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isMailAddress = (s: string) => s.length <= 254 && EMAIL.test(s);
/** No CR, LF or other control characters may reach a header. */
const oneLine = (s: string, max = 200) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** RFC 2047 for a header value that is not plain ASCII. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n');

export interface OutgoingMessage {
  from: { address: string; name: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, already safe (List-Unsubscribe etc.). */
  headers?: Record<string, string>;
  messageIdDomain: string;
  date: Date;
}

/** A complete RFC 5322 message with CRLF line ends: multipart/alternative, base64 UTF-8 parts. */
export function buildMessage(m: OutgoingMessage): string {
  if (!isMailAddress(m.from.address) || !isMailAddress(m.to)) throw new Error('invalid mail address');
  const boundary = `=_inflight_${randomBytes(12).toString('hex')}`;
  const headers: [string, string][] = [
    ['From', `${encodeHeader(oneLine(m.from.name, 80))} <${m.from.address}>`],
    ['To', `<${m.to}>`],
    ['Subject', encodeHeader(oneLine(m.subject))],
    ['Date', m.date.toUTCString().replace('GMT', '+0000')],
    ['Message-ID', `<${randomBytes(16).toString('hex')}@${m.messageIdDomain}>`],
    ['MIME-Version', '1.0'],
    ...Object.entries(m.headers ?? {}).map(([k, v]) => [oneLine(k, 60), oneLine(v, 900)] as [string, string]),
    ['Content-Type', `multipart/alternative; boundary="${boundary}"`],
  ];
  const part = (type: string, body: string) => [
    `--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(body, 'utf8').toString('base64')).trimEnd(),
  ].join('\r\n');
  return [...headers.map(([k, v]) => `${k}: ${v}`), '', part('text/plain', m.text), part('text/html', m.html), `--${boundary}--`, ''].join('\r\n');
}

// ---- SMTP (submission, STARTTLS required) ---------------------------------------------------------------------------

export interface MailTransport { send(envelopeFrom: string, to: string, raw: string): Promise<void> }

export interface SmtpOptions {
  host: string; port: number; username: string;
  /** Read at run time; the value is never logged or kept in an error. */
  password: () => Promise<string>;
  /** Our name in EHLO. */
  heloName?: string;
  timeoutMs?: number;
  /** Tests replace the network; production uses TCP then TLS. */
  connect?: (host: string, port: number) => Socket;
  startTls?: (socket: Socket, host: string) => Promise<Socket>;
}

class SmtpReader {
  private buffer = '';
  private waiters: ((line: string) => void)[] = [];
  private lines: string[] = [];
  private failure: Error | null = null;
  constructor(socket: Socket) { this.attach(socket); }
  attach(socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\r\n')) >= 0) { const line = this.buffer.slice(0, i); this.buffer = this.buffer.slice(i + 2); const w = this.waiters.shift(); if (w) w(line); else this.lines.push(line); }
    });
    socket.on('error', (e) => { this.failure = e; });
  }
  private line(timeoutMs: number): Promise<string> {
    if (this.failure) return Promise.reject(new Error('SMTP connection failed'));
    const ready = this.lines.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('SMTP timed out')), timeoutMs);
      this.waiters.push((l) => { clearTimeout(t); resolve(l); });
    });
  }
  /** One reply, which may be several lines (`250-...` then `250 ...`). */
  async reply(timeoutMs: number): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      const l = await this.line(timeoutMs);
      lines.push(l.slice(4));
      if (!/^\d{3}[ -]/.test(l)) throw new Error('SMTP sent an unreadable reply');
      if (l[3] === ' ') return { code: Number(l.slice(0, 3)), lines };
    }
  }
}

export class SmtpTransport implements MailTransport {
  constructor(private readonly o: SmtpOptions) {}
  async send(envelopeFrom: string, to: string, raw: string): Promise<void> {
    if (!isMailAddress(envelopeFrom) || !isMailAddress(to)) throw new Error('invalid mail address');
    const timeout = this.o.timeoutMs ?? 20_000;
    const connect = this.o.connect ?? ((h, p) => netConnect({ host: h, port: p }));
    const startTls = this.o.startTls ?? ((socket, host) => new Promise<Socket>((resolve, reject) => {
      const s = tlsConnect({ socket, servername: host, minVersion: 'TLSv1.2' }, () => resolve(s));
      s.once('error', reject);
    }));
    let socket = connect(this.o.host, this.o.port);
    let reader = new SmtpReader(socket);
    const write = (line: string) => socket.write(line + '\r\n');
    const expect = async (codes: number[], step: string) => {
      const r = await reader.reply(timeout);
      if (!codes.includes(r.code)) throw new Error(`SMTP ${step} refused (${r.code})`); // never echo server text: it can quote our input
      return r;
    };
    try {
      await expect([220], 'greeting');
      write(`EHLO ${this.o.heloName ?? 'inflight.studio'}`);
      const ehlo = await expect([250], 'EHLO');
      if (!ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) throw new Error('SMTP server does not offer STARTTLS; not sending credentials');
      write('STARTTLS');
      await expect([220], 'STARTTLS');
      socket.removeAllListeners('data');
      socket = await startTls(socket, this.o.host);
      reader = new SmtpReader(socket);
      write(`EHLO ${this.o.heloName ?? 'inflight.studio'}`);
      await expect([250], 'EHLO after TLS');
      const password = await this.o.password();
      write(`AUTH PLAIN ${Buffer.from(`\u0000${this.o.username}\u0000${password}`, 'utf8').toString('base64')}`);
      await expect([235], 'AUTH');
      write(`MAIL FROM:<${envelopeFrom}>`);
      await expect([250], 'MAIL FROM');
      write(`RCPT TO:<${to}>`);
      await expect([250, 251], 'RCPT TO');
      write('DATA');
      await expect([354], 'DATA');
      // Dot-stuffing (RFC 5321 4.5.2), then the end-of-data line.
      socket.write(raw.replace(/\r\n\./g, '\r\n..').replace(/^\./, '..') + (raw.endsWith('\r\n') ? '' : '\r\n') + '.\r\n');
      await expect([250], 'message');
      write('QUIT');
      await expect([221], 'QUIT').catch(() => undefined); // the message is already accepted
    } finally {
      socket.end();
    }
  }
}

/** The app password from Secret Manager, read once on first use with the service's own identity, kept in memory only. */
export function secretManagerValue(resource: string, token: () => Promise<string>, fetcher: typeof fetch = fetch): () => Promise<string> {
  if (!/^projects\/[a-z][a-z0-9-]+\/secrets\/[A-Za-z0-9_-]+\/versions\/(latest|\d+)$/.test(resource)) throw new Error('KCP_SMTP_PASSWORD_SECRET must be projects/<p>/secrets/<name>/versions/<n|latest>');
  let cached: Promise<string> | undefined;
  return () => {
    cached ??= (async () => {
      const r = await fetcher(`https://secretmanager.googleapis.com/v1/${resource}:access`, { headers: { authorization: `Bearer ${await token()}` } });
      if (!r.ok) throw new Error(`Secret Manager ${r.status}`);
      const body = (await r.json()) as { payload?: { data?: string } };
      const value = Buffer.from(body.payload?.data ?? '', 'base64').toString('utf8').trim();
      if (!value) throw new Error('mail secret is empty');
      return value;
    })().catch((e) => { cached = undefined; throw e; });
    return cached;
  };
}

// ---- Limits and unsubscribes (Firestore) ---------------------------------------------------------------------------

export type MailRefusal = 'unsubscribed' | 'daily-limit' | 'sender-limit' | 'recipient-limit';

export interface MailLedger {
  isSuppressed(recipientHash: string): Promise<boolean>;
  suppress(recipientHash: string, atMs: number): Promise<void>;
  /** Count one message against every limit in one transaction, or refuse without counting. */
  reserve(day: string, senderAccountId: string, recipientHash: string, limits: MailLimits): Promise<MailRefusal | null>;
  /** Messages counted for one day (UTC). */
  sentOn(day: string): Promise<number>;
}

export class FirestoreMailLedger implements MailLedger {
  constructor(private readonly db: FirestoreLike) {}
  async isSuppressed(h: string) { return (await this.db.collection('mail_suppressions').doc(h).get()).exists; }
  async suppress(h: string, atMs: number) { await this.db.collection('mail_suppressions').doc(h).set({ atDay: new Date(atMs).toISOString().slice(0, 10) }); }
  async sentOn(day: string) { return Number((await this.db.collection('mail_daily').doc(day).get()).data()?.count ?? 0); }
  async reserve(day: string, sender: string, recipient: string, l: MailLimits): Promise<MailRefusal | null> {
    return this.db.runTransaction(async (tx) => {
      const col = this.db.collection('mail_daily');
      const refs = { total: col.doc(day), sender: col.doc(`${day}|s|${sender}`), recipient: col.doc(`${day}|r|${recipient}`) };
      const [t, s, r] = await Promise.all([tx.get(refs.total), tx.get(refs.sender), tx.get(refs.recipient)]);
      const n = (d: typeof t) => Number(d.data()?.count ?? 0);
      if (n(t) >= Math.min(l.daily, MAIL_HARD_DAILY_MAX)) return 'daily-limit';
      if (n(s) >= l.perSender) return 'sender-limit';
      if (n(r) >= l.perRecipient) return 'recipient-limit';
      tx.set(refs.total, { day, count: n(t) + 1 });
      tx.set(refs.sender, { day, count: n(s) + 1 });
      tx.set(refs.recipient, { day, count: n(r) + 1 });
      return null;
    });
  }
}

// ---- The mailer -----------------------------------------------------------------------------------------------------

export interface MailerOptions {
  transport: MailTransport;
  ledger: MailLedger;
  /** hello@inflight.studio once it is a verified "Send mail as" address, or the Gmail address itself (fromAddressFor). */
  fromAddress: string;
  /** The sending account's type, which sets the hard daily cap (default Workspace). */
  account?: MailAccountKind;
  fromName?: string;
  /** The public website, which forwards /v1/mail/** to the control plane (firebase.json). */
  siteOrigin: string;
  /** Signs unsubscribe links. */
  unsubscribeKey: Buffer;
  limits?: MailLimits;
  now?: () => number;
}

export interface InvitationMail {
  to: string; recipientHash: string; senderAccountId: string; inviterName: string; projectName: string;
  role: 'editor' | 'commenter' | 'viewer' | 'client';
  /** The recipient's language (the inviter's app language until we know theirs); British English if unknown. */
  language?: string;
}

export type UnsubscribeStream = 'news' | 'notice';
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class Mailer {
  readonly limits: MailLimits;
  readonly account: MailAccountKind;
  constructor(private readonly o: MailerOptions) {
    if (!isMailAddress(o.fromAddress)) throw new Error('KCP_MAIL_FROM must be an email address');
    if (!/^https:\/\/[^/]+$/.test(o.siteOrigin)) throw new Error('KCP_SITE_ORIGIN must be a bare https origin');
    this.account = o.account ?? 'workspace';
    const l = o.limits ?? { ...DEFAULT_MAIL_LIMITS, daily: Math.min(DEFAULT_MAIL_LIMITS.daily, hardDailyMax(this.account)) };
    if (l.daily > hardDailyMax(this.account)) throw new Error(`the daily mail limit cannot exceed ${hardDailyMax(this.account)}${this.account === 'gmail' ? ' on a Gmail account' : ''}`);
    this.limits = l;
  }

  /** The public website the links in every email point to. */
  get siteOrigin(): string { return this.o.siteOrigin; }
  unsubscribeToken(recipientHash: string) { return createHmac('sha256', this.o.unsubscribeKey).update(`unsubscribe:${recipientHash}`).digest('base64url'); }
  /** The recipient hash a valid token belongs to, or null. */
  checkUnsubscribe(recipientHash: string, token: string): boolean {
    if (!/^[0-9a-f]{64}$/.test(recipientHash)) return false;
    const a = Buffer.from(this.unsubscribeToken(recipientHash)); const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  /** Today's count against the limits, for /admin. `warn` from 80% of our cap, which is always under Google's limit. */
  async today(): Promise<{ day: string; sent: number; cap: number; account: MailAccountKind; providerLimit: number; from: string; warn: boolean }> {
    const day = new Date((this.o.now ?? Date.now)()).toISOString().slice(0, 10);
    const sent = await this.o.ledger.sentOn(day);
    const cap = Math.min(this.limits.daily, hardDailyMax(this.account));
    return { day, sent, cap, account: this.account, providerLimit: providerDailyLimit(this.account), from: this.o.fromAddress, warn: sent >= Math.ceil(cap * 0.8) };
  }
  /**
   * Mail to the owner (a website contact message): plain text with an escaped copy as HTML, no unsubscribe link (it
   * never goes to a customer). Counts against the daily cap like every email; the per-sender and per-recipient limits,
   * meant for invitations and notices, would cut the owner off after a few messages, so they do not apply here.
   */
  async sendToOwner(m: { to: string; subject: string; text: string; replyTo?: string }): Promise<{ sent: true } | { sent: false; reason: MailRefusal }> {
    const nowMs = (this.o.now ?? Date.now)();
    const limits = { daily: this.limits.daily, perSender: Number.MAX_SAFE_INTEGER, perRecipient: Number.MAX_SAFE_INTEGER };
    const refused = await this.o.ledger.reserve(new Date(nowMs).toISOString().slice(0, 10), 'owner:contact-form', emailHashOf(m.to), limits);
    if (refused) return { sent: false, reason: refused };
    const replyTo = m.replyTo ? safeReplyTo(m.replyTo) : undefined;
    const text = m.text.replace(/\r?\n/g, '\r\n');
    const raw = buildMessage({
      from: { address: this.o.fromAddress, name: this.o.fromName ?? 'InFlight' }, to: m.to, subject: m.subject, text,
      html: `<!doctype html><html lang="en-GB"><body><pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(m.text)}</pre></body></html>`,
      date: new Date(nowMs), messageIdDomain: this.o.fromAddress.split('@')[1],
      headers: { ...(replyTo ? { 'Reply-To': `<${replyTo}>` } : {}), 'Auto-Submitted': 'auto-generated' },
    });
    await this.o.transport.send(this.o.fromAddress, m.to, raw);
    return { sent: true };
  }
  async unsubscribe(recipientHash: string) { await this.o.ledger.suppress(recipientHash, (this.o.now ?? Date.now)()); }

  /**
   * A link that stops one kind of email for one account (news = marketing, notice = product emails), so stopping news
   * does not also stop a licence key, and turning it back on in Settings works. Invitations (to people who may have no
   * account) and account emails keep the address-wide link above.
   */
  streamUnsubscribeToken(stream: UnsubscribeStream, accountId: string) { return createHmac('sha256', this.o.unsubscribeKey).update(`unsubscribe:${stream}:${accountId}`).digest('base64url'); }
  checkStreamUnsubscribe(stream: string, accountId: string, token: string): stream is UnsubscribeStream {
    if ((stream !== 'news' && stream !== 'notice') || !ACCOUNT_ID.test(accountId)) return false;
    const a = Buffer.from(this.streamUnsubscribeToken(stream, accountId)); const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Sends one invitation, or says why not. Never throws for a limit; throws only when sending itself failed. */
  async sendInvitation(m: InvitationMail): Promise<{ sent: true } | { sent: false; reason: MailRefusal }> {
    if (await this.o.ledger.isSuppressed(m.recipientHash)) return { sent: false, reason: 'unsubscribed' };
    const nowMs = (this.o.now ?? Date.now)();
    const refused = await this.o.ledger.reserve(new Date(nowMs).toISOString().slice(0, 10), m.senderAccountId, m.recipientHash, this.limits);
    if (refused) return { sent: false, reason: refused };
    const site = this.o.siteOrigin;
    const lang = htmlLang(m.language);
    const w = mailWords(lang).invitation;
    const unsub = `${site}/v1/mail/unsubscribe?r=${m.recipientHash}&t=${this.unsubscribeToken(m.recipientHash)}&l=${encodeURIComponent(lang)}`;
    const inviter = oneLine(m.inviterName, 80) || w.someone;
    const project = oneLine(m.projectName, 120);
    const as = w.as[m.role];
    const text = [w.invited(inviter, project, as), '', w.join, `${w.open}: ${site}`, '', w.ignore, '', `${w.stop}: ${unsub}`].join('\r\n');
    const html = `<!doctype html><html lang="${escapeHtml(lang)}"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a">`
      + `<p>${escapeHtml(w.invited(inviter, project, as))}</p>`
      + `<p>${escapeHtml(w.join)}</p>`
      + `<p><a href="${escapeHtml(site)}">${escapeHtml(w.open)}</a></p>`
      + `<p>${escapeHtml(w.ignore)}</p>`
      + `<p style="font-size:0.85em;color:#555"><a href="${escapeHtml(unsub)}">${escapeHtml(w.stop)}</a></p></body></html>`;
    const raw = buildMessage({
      from: { address: this.o.fromAddress, name: this.o.fromName ?? 'InFlight' }, to: m.to,
      subject: w.subject(inviter, project), text, html, date: new Date(nowMs),
      messageIdDomain: this.o.fromAddress.split('@')[1],
      headers: {
        'List-Unsubscribe': `<${unsub}>, <mailto:${this.o.fromAddress}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'Auto-Submitted': 'auto-generated',
      },
    });
    await this.o.transport.send(this.o.fromAddress, m.to, raw);
    return { sent: true };
  }

  /**
   * One notice email (collaboration notices, G20). `text` is already in the recipient's language: paragraphs split by
   * blank lines, links as bare https URLs. The HTML part is built from it (escaped, links made clickable), and the
   * unsubscribe footer and headers are added in `language`. Same unsubscribe list and limits as invitations; the
   * per-sender limit counts notices per recipient account.
   */
  async sendNotice(m: { to: string; accountId: string; subject: string; text: string; language?: string; stream?: 'notice' | 'news' | 'account' }): Promise<{ sent: true } | { sent: false; reason: MailRefusal }> {
    const recipientHash = emailHashOf(m.to);
    if (await this.o.ledger.isSuppressed(recipientHash)) return { sent: false, reason: 'unsubscribed' };
    const nowMs = (this.o.now ?? Date.now)();
    const refused = await this.o.ledger.reserve(new Date(nowMs).toISOString().slice(0, 10), `${m.stream ?? 'notice'}:${m.accountId}`, recipientHash, this.limits);
    if (refused) return { sent: false, reason: refused };
    const lang = htmlLang(m.language);
    const w = mailWords(lang).invitation;
    const scoped = (m.stream === 'news' || m.stream === 'notice') && ACCOUNT_ID.test(m.accountId) ? m.stream : null;
    const unsub = scoped
      ? `${this.o.siteOrigin}/v1/mail/unsubscribe?s=${scoped}&a=${m.accountId}&t=${this.streamUnsubscribeToken(scoped, m.accountId)}&l=${encodeURIComponent(lang)}`
      : `${this.o.siteOrigin}/v1/mail/unsubscribe?r=${recipientHash}&t=${this.unsubscribeToken(recipientHash)}&l=${encodeURIComponent(lang)}`;
    const paragraphs = m.text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 20);
    const linkify = (p: string) => escapeHtml(p).replace(/https:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`).replace(/\n/g, '<br>');
    const stop = scoped === 'news' ? mailWords(lang).unsubscribe.stopNews : scoped === 'notice' ? mailWords(lang).unsubscribe.stopNotices : w.stop;
    const text = [...paragraphs, `${stop}: ${unsub}`].map((p) => p.replace(/\n/g, '\r\n')).join('\r\n\r\n');
    const html = `<!doctype html><html lang="${escapeHtml(lang)}"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a">`
      + paragraphs.map((p) => `<p>${linkify(p)}</p>`).join('')
      + `<p style="font-size:0.85em;color:#555"><a href="${escapeHtml(unsub)}">${escapeHtml(stop)}</a></p></body></html>`;
    const raw = buildMessage({
      from: { address: this.o.fromAddress, name: this.o.fromName ?? 'InFlight' }, to: m.to,
      subject: m.subject, text, html, date: new Date(nowMs), messageIdDomain: this.o.fromAddress.split('@')[1],
      headers: {
        'List-Unsubscribe': `<${unsub}>, <mailto:${this.o.fromAddress}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'Auto-Submitted': 'auto-generated',
      },
    });
    await this.o.transport.send(this.o.fromAddress, m.to, raw);
    return { sent: true };
  }
}

/** One address for Reply-To: a valid single address with nothing that could start another header or list. */
export function safeReplyTo(email: string): string | undefined {
  const e = email.trim();
  return e && !/[\r\n,;<>"\s]/.test(e) && isMailAddress(e) ? e : undefined;
}

/**
 * A website contact-form message as the email to the owner (KCP_CONTACT_NOTIFY_TO): plain text only, nothing from
 * the sender is ever HTML or a header except a validated Reply-To, so replying answers the visitor.
 */
export function contactAlertMail(m: { name: string; email: string; message: string; messageId: string }, at: Date) {
  const name = oneLine(m.name, 100);
  return {
    subject: `InFlight contact: ${name}`,
    replyTo: safeReplyTo(m.email),
    text: [`Name: ${name}`, `Email: ${oneLine(m.email, 254)}`, `Received: ${at.toISOString()}`, `Reference: ${m.messageId}`, '', 'Message:',
      m.message.replace(/\r\n?/g, '\n').slice(0, 10_000), '', 'This message is also kept in /admin, Messages.'].join('\n'),
  };
}

/**
 * Where to email an account's notices: its verified sign-in address, looked up when needed and never stored
 * (src/noticeContacts.ts). Undefined when there is none to use.
 */
export type NoticeAddressBook = (accountId: string) => Promise<{ address: string; language?: string } | undefined>;
export const NO_NOTICE_ADDRESSES: NoticeAddressBook = async () => undefined;

/**
 * The email side of the collaboration `NoticeDelivery` port (services/control-plane/src/notices.ts). Push comes from
 * push.ts; this `push` answers 'no-device' for callers without FCM. Email: through the mailer, only to the address the
 * address book gives; over a daily limit it is 'held' (the in-app inbox still has the notice), and an unsubscribed
 * address counts as no address. A failed send throws; the notices code never lets that fail the action.
 */
export function mailNoticeDelivery(mailer: Mailer | undefined, addresses: NoticeAddressBook = NO_NOTICE_ADDRESSES, wantsEmail: (accountId: string) => Promise<boolean> = async () => true) {
  return {
    push: async (_accountId: string, _message: { title: string; body: string; data: Record<string, string> }): Promise<'sent' | 'no-device'> => 'no-device',
    email: async (accountId: string, message: { subject: string; text: string; urgent: false }): Promise<'sent' | 'held' | 'no-address'> => {
      if (!mailer) return 'no-address';
      // Product emails switched off in Communication preferences (or by the link in one): the inbox still has it.
      if (!(await wantsEmail(accountId))) return 'no-address';
      const to = await addresses(accountId);
      if (!to || !isMailAddress(to.address)) return 'no-address';
      const r = await mailer.sendNotice({ to: to.address, accountId, subject: message.subject, text: message.text, language: to.language, stream: 'notice' });
      return r.sent ? 'sent' : r.reason === 'unsubscribed' ? 'no-address' : 'held';
    },
  };
}
