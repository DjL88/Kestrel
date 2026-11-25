/**
 * Push notifications through Firebase Cloud Messaging (G20, #1343, owner decision 11: in the app first, push next,
 * email last). Rules shared with the app: src/core/pushNotices.ts.
 *
 * - Devices: one Firestore document per FCM token (`push_devices`, id = SHA-256 of the token), owned by the account that
 *   registered it last, so a browser shared between two sign-ins never gets the other person's alerts. Registering is
 *   only ever done after the person turned alerts on; signing out removes the token. A token FCM says is gone is deleted.
 * - Preferences: `push_prefs/<account>`, which kinds to push. A kind switched off is neither pushed nor emailed.
 * - Sending: FCM HTTP v1 with the service's own Cloud Run identity (no key file). Names and counts and opaque ids only.
 *   "Accepted by FCM" is not "delivered" or "read": the in-app inbox remains the record.
 * - Off by default: only when KCP_PUSH_ENABLED=1 (and a Firebase project id) is this built, and the `push` admin switch
 *   must then be on before anything is sent.
 */
import { createHash } from 'node:crypto';
import type { FirestoreLike } from './firestoreStore.ts';
import { cleanPreferences, MAX_PUSH_DEVICES, pushCategory, type PushPlatform, type PushPreferences } from '../../../src/core/pushNotices.ts';
import type { NoticeKind } from '../../../src/core/collabNotices.ts';
import type { NoticeDelivery } from './notices.ts';

const C = { devices: 'push_devices', prefs: 'push_prefs' };
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface PushMessage { title: string; body: string; data: Record<string, string> }
export type SendResult = 'ok' | 'gone' | 'error';
/** Sends one message to one device token. */
export interface PushSender { send(token: string, message: PushMessage): Promise<SendResult> }

interface DeviceDoc { accountId: string; token: string; platform: PushPlatform; createdAtMs: number; lastSeenAtMs: number }

export class PushService {
  private gate: () => Promise<boolean> = async () => true;
  constructor(private readonly db: FirestoreLike, private readonly sender: PushSender, private readonly log: (m: string) => void = () => undefined) {}

  /** The app's admin `push` switch. Until it is on, nothing is sent and no device is registered. */
  setGate(gate: () => Promise<boolean>) { this.gate = gate; }
  on(): Promise<boolean> { return this.gate(); }

  async register(accountId: string, token: string, platform: PushPlatform, atMs: number): Promise<number> {
    const ref = this.db.collection(C.devices).doc(tokenHash(token));
    const existing = await ref.get();
    const createdAtMs = existing.exists && existing.data()!.accountId === accountId ? Number(existing.data()!.createdAtMs) : atMs;
    await ref.set({ accountId, token, platform, createdAtMs, lastSeenAtMs: atMs });
    const mine = await this.devices(accountId);
    // Keep the newest few: an old phone that was never signed out stops getting alerts first.
    for (const old of mine.sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs).slice(MAX_PUSH_DEVICES)) {
      await this.drop(old.token);
    }
    return Math.min(mine.length, MAX_PUSH_DEVICES);
  }

  /** Signing out, or turning alerts off on this device. Only the account that owns the token can remove it. */
  async remove(accountId: string, token: string): Promise<boolean> {
    const ref = this.db.collection(C.devices).doc(tokenHash(token));
    const got = await ref.get();
    if (!got.exists || got.data()!.accountId !== accountId) return false;
    await this.drop(token);
    return true;
  }

  private async drop(token: string): Promise<void> {
    const ref = this.db.collection(C.devices).doc(tokenHash(token));
    await this.db.runTransaction(async (tx) => { tx.delete(ref); });
  }

  async devices(accountId: string): Promise<DeviceDoc[]> {
    const snap = await this.db.collection(C.devices).where('accountId', '==', accountId).get();
    return snap.docs.map((d) => d.data() as unknown as DeviceDoc);
  }

  async preferences(accountId: string): Promise<PushPreferences> {
    const got = await this.db.collection(C.prefs).doc(accountId).get();
    return cleanPreferences(got.exists ? got.data() : null);
  }

  async setPreferences(accountId: string, change: Partial<PushPreferences>): Promise<PushPreferences> {
    const next = cleanPreferences({ ...(await this.preferences(accountId)), ...change });
    await this.db.collection(C.prefs).doc(accountId).set({ ...next });
    return next;
  }

  /**
   * Pushes to every device the account has. 'off' when the person switched this kind off (nothing else is sent either),
   * 'no-device' when nothing accepted it (then email may follow), 'sent' when FCM accepted it for at least one device.
   */
  async push(accountId: string, message: PushMessage): Promise<'sent' | 'no-device' | 'off'> {
    if (!(await this.gate())) return 'no-device';
    const kind = message.data.kind as NoticeKind | undefined;
    if (kind && !(await this.preferences(accountId))[pushCategory(kind)]) return 'off';
    let sent = 0;
    for (const device of await this.devices(accountId)) {
      const result = await this.sender.send(device.token, message).catch((): SendResult => 'error');
      if (result === 'ok') sent += 1;
      else if (result === 'gone') await this.drop(device.token).catch(() => undefined);
      else this.log('push: FCM did not accept a message (the inbox has it)');
    }
    return sent > 0 ? 'sent' : 'no-device';
  }
}

/** The notices delivery port with push from here and email from the mailer's port (src/mailer.ts). */
export function noticeDelivery(push: PushService | undefined, email: NoticeDelivery['email']): NoticeDelivery {
  return { push: push ? (accountId, message) => push.push(accountId, message) : async () => 'no-device', email };
}

/**
 * FCM HTTP v1. `token` gives an OAuth access token for the service account (the Cloud Run metadata server in
 * production), which needs the Firebase Cloud Messaging API Admin role on the Firebase project.
 */
export class FcmSender implements PushSender {
  constructor(private readonly projectId: string, private readonly token: () => Promise<string>, private readonly fetcher: typeof fetch = fetch) {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw new Error('KCP_FCM_PROJECT_ID must be a Firebase project id');
  }

  async send(token: string, m: PushMessage): Promise<SendResult> {
    const body = {
      message: {
        token,
        notification: { title: m.title, body: m.body },
        // Words are copied into data too, so the web service worker can show the notice itself (no Firebase script).
        data: { ...m.data, title: m.title, body: m.body },
        android: { priority: 'NORMAL', ttl: '86400s' },
        apns: { headers: { 'apns-priority': '5' } },
        webpush: { headers: { TTL: '86400', Urgency: 'normal' } },
      },
    };
    const r = await this.fetcher(`https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.ok) return 'ok';
    const text = await r.text().catch(() => '');
    // The token no longer works (app removed, browser data cleared, another sender): forget it.
    if (r.status === 404 || /UNREGISTERED|SENDER_ID_MISMATCH/.test(text) || (r.status === 400 && /registration token/i.test(text))) return 'gone';
    return 'error';
  }
}
