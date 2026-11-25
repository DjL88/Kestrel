/**
 * InFlight product news (updates, new features), sent by an administrator from /admin. Push first, email only as the
 * fallback, and only to people who asked for news by email (owner, 25 Nov 2026; UK PECR treats feature announcements as
 * marketing, so email is opt-in and starts off).
 *
 * - Push: every account with a device for alerts, unless the person switched "InFlight news" off (then nothing else is
 *   sent either, the same rule as team notices).
 * - Email: only when push reached none of that person's devices, and only if they turned on "Email me InFlight news".
 *   Through the mailer and its daily cap, with the unsubscribe link and List-Unsubscribe headers every app email has.
 * - The daily cap: when today's email limit is reached the broadcast stops emailing and reports how many are still
 *   waiting. Sending the same broadcast again (same id) on a later day reaches only those not yet reached, by push or
 *   email; nobody gets the same news twice. Nothing is queued in the background.
 * - Off unless the `product-news` admin switch is on. A dry run counts who would be reached and sends nothing.
 *
 * Firestore: `news_broadcasts/<id>` { title, body, createdAtMs } and `news_deliveries/<id>|<accountId>` { via, atMs }.
 */
import { docId, type FirestoreLike } from './firestoreStore.ts';
import { uuid } from './crypto.ts';
import type { PushService } from './push.ts';
import type { Mailer, NoticeAddressBook } from './mailer.ts';
import type { NoticeContacts } from './noticeContacts.ts';
import { mailWords, htmlLang } from './mailText.ts';
import { NEWS_KIND } from '../../../src/core/pushNotices.ts';

const C = { broadcasts: 'news_broadcasts', deliveries: 'news_deliveries' };
/** At most this many people per run, so one request stays well inside Cloud Run's time limit; run again for the rest. */
export const NEWS_BATCH = 2000;

export interface NewsReport {
  broadcastId: string;
  dryRun: boolean;
  /** People this news is for: devices for alerts, or product news by email. */
  audience: number;
  alreadyReached: number;
  pushed: number;
  emailed: number;
  /** Switched "InFlight news" off. */
  off: number;
  /** No device took the push and no email opt-in, or no verified address. */
  unreachable: number;
  /** Not emailed yet: today's email limit was reached, a per-person limit, or the send failed. Send again tomorrow. */
  emailWaiting: number;
  /** Not tried in this run (more than NEWS_BATCH people); send again. */
  notTried: number;
  emailLimitReached: boolean;
}

export class NewsBroadcaster {
  /** Whether app email may be sent now: the app sets it to the `email` admin switch. */
  private emailGate: () => Promise<boolean> = async () => true;
  constructor(private readonly db: FirestoreLike, private readonly deps: {
    push?: PushService; mailer?: Mailer; contacts?: NoticeContacts; addressBook?: NoticeAddressBook;
    newId?: () => string; log?: (m: string) => void;
  }) {}
  setEmailGate(gate: () => Promise<boolean>) { this.emailGate = gate; }

  async send(input: { broadcastId?: string; title: string; body: string; dryRun: boolean }, atMs: number): Promise<NewsReport> {
    const broadcastId = input.broadcastId ?? (this.deps.newId ?? uuid)();
    const ref = this.db.collection(C.broadcasts).doc(broadcastId);
    const existing = await ref.get();
    // Resuming keeps the words first sent, so a later run cannot change what part of the audience already got.
    const words = existing.exists ? { title: String(existing.data()!.title), body: String(existing.data()!.body) } : { title: input.title, body: input.body };
    if (!input.dryRun && !existing.exists) await ref.set({ broadcastId, ...words, createdAtMs: atMs });

    const withDevices = this.deps.push ? await this.deps.push.accountsWithDevices() : [];
    const newsEmail = new Set(this.deps.contacts ? await this.deps.contacts.productNewsAccounts() : []);
    const audience = [...new Set([...withDevices, ...newsEmail])].sort();
    const report: NewsReport = { broadcastId, dryRun: input.dryRun, audience: audience.length, alreadyReached: 0, pushed: 0, emailed: 0, off: 0, unreachable: 0, emailWaiting: 0, notTried: 0, emailLimitReached: false };
    const emailOn = !!this.deps.mailer && !!this.deps.addressBook && (await this.emailGate());
    const pushOn = !!this.deps.push && (await this.deps.push.on());
    let tried = 0;
    for (const accountId of audience) {
      const delivery = this.db.collection(C.deliveries).doc(docId(broadcastId, accountId));
      if ((await delivery.get()).exists) { report.alreadyReached += 1; continue; }
      if (tried >= NEWS_BATCH) { report.notTried += 1; continue; }
      tried += 1;
      if (input.dryRun) {
        const prefs = this.deps.push ? await this.deps.push.preferences(accountId) : null;
        if (prefs && !prefs.news) report.off += 1;
        else if (pushOn && withDevices.includes(accountId)) report.pushed += 1;
        else if (emailOn && newsEmail.has(accountId)) report.emailed += 1;
        else report.unreachable += 1;
        continue;
      }
      const pushed = this.deps.push ? await this.deps.push.push(accountId, { title: words.title, body: words.body, data: { kind: NEWS_KIND, newsId: broadcastId } }) : 'no-device';
      if (pushed === 'off') { report.off += 1; await delivery.set({ via: 'off', atMs }); continue; }
      if (pushed === 'sent') { report.pushed += 1; await delivery.set({ via: 'push', atMs }); continue; }
      // FCM is not available for this person, or did not reach them: email only with their opt-in.
      if (!emailOn || !newsEmail.has(accountId)) { report.unreachable += 1; continue; }
      if (report.emailLimitReached) { report.emailWaiting += 1; continue; }
      const to = await this.deps.addressBook!(accountId).catch(() => undefined);
      if (!to) { report.unreachable += 1; continue; }
      try {
        const lang = htmlLang(to.language);
        const text = `${words.body}\n\n${mailWords(lang).invitation.open}: ${this.deps.mailer!.siteOrigin}\n\n${mailWords(lang).news.why}`;
        const r = await this.deps.mailer!.sendNotice({ to: to.address, accountId, subject: words.title, text, language: to.language, stream: 'news' });
        if (r.sent) { report.emailed += 1; await delivery.set({ via: 'email', atMs }); }
        else if (r.reason === 'unsubscribed') report.unreachable += 1;
        else { report.emailWaiting += 1; if (r.reason === 'daily-limit') report.emailLimitReached = true; }
      } catch {
        // Never the address or the server's words in a log.
        this.deps.log?.('news: an email could not be sent; it will be tried again when this news is sent again');
        report.emailWaiting += 1;
      }
    }
    return report;
  }
}
