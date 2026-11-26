/**
 * Talks to the control plane about this device's licence: activate (and renew), list the key's devices, free one.
 * Everything it needs is passed in, so the same code runs in the app (licenceStore.ts) and in tests against a real
 * control plane. It never sends anything but the key, a random per-device hash, the platform and the app version.
 */
import { verifyEntitlementGrant, type EntitlementGrant } from '../core/entitlementGrant';
import { type AccountStanding, type KestrelPlatform, type OnlineStanding } from '../core/licenceOnline';
import { sha256Hex, type PinnedKeys } from '../core/signedEnvelope';
import { CHECKOUT_ID, checkoutErrorText, parseCheckoutPoll, parseCheckoutStart, type CheckoutPoll, type CheckoutStart } from '../core/proCheckout';

export interface KeyValueStorage { getItem(name: string): string | null; setItem(name: string, value: string): void; removeItem(name: string): void }

export interface LicenceSyncOptions {
  /** Control plane address, or null when this build has none. */
  baseUrl: string | null;
  /** Pinned public keys for grants. Empty means grants cannot be checked, so the online part is off. */
  grantKeys: PinnedKeys;
  storage: KeyValueStorage;
  fetch: typeof fetch;
  now: () => number;
  platform: KestrelPlatform;
  appVersion: string;
  /** Fresh random id for this device, made once. */
  randomId?: () => string;
  /** Waits out a "too many attempts" answer; tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
}

export interface LicenceDevice { activationId: string; platform: string; appVersion: string; lastSeenMs: number; thisDevice: boolean }
export interface LicenceStatus { status: 'active' | 'revoked' | 'expired' | 'unknown'; validUntilMs: number | null; maxDevices: number; devices: LicenceDevice[] }

const DEVICE = 'kestrel.device.v1';
const GRANT = 'kestrel.licence.grant.v1';
const REVOKED = 'kestrel.licence.revoked.v1';
const DENIED = 'kestrel.licence.denied.v1';
const ACCOUNT_GRANT = 'kestrel.licence.account-grant.v1';
/** When each key was first used on this device (by key hash), for the one-time check-in (NEW_DEVICE_CHECK_IN_DAYS). */
const FIRST_USE = 'kestrel.licence.first-use.v1';
const TIMEOUT_MS = 12_000;
/**
 * How long to wait after each "too many attempts" (429) answer at sign-in before asking again. The server counts per
 * minute, so the waits add up to just over a minute; after that the check gives up and says the service could not be
 * reached, as before. (26 Nov beta: a refused check left Pro off until the person pressed Check Pro online.)
 */
const BUSY_WAITS_MS = [15_000, 20_000, 30_000];

interface StoredGrant { envelope: unknown; activationId: string; licenceKeyHash: string }

export class LicenceSync {
  private accountCheck = 0;
  /** The server's own words when the last device free was refused because the yearly allowance is used up. */
  releaseRefusal: string | null = null;
  private noteRefusal(reply: { status: number; json: Record<string, any> | null }) {
    this.releaseRefusal = reply.status === 429 && reply.json?.error?.code === 'RELEASE_LIMIT' && typeof reply.json.error.message === 'string'
      ? reply.json.error.message.slice(0, 600) : null;
  }
  /** The control-plane session from the last sign-in. Kept in memory only (never stored), so it ends with the app or sign-out. */
  private session: string | null = null;
  constructor(private readonly o: LicenceSyncOptions) {}

  /** The address and in-memory session for account-only services such as cloud processing, or null when signed out or not set up. */
  accountConnection(): { baseUrl: string; session: string } | null {
    return this.o.baseUrl && this.session ? { baseUrl: this.o.baseUrl, session: this.session } : null;
  }

  get configured(): boolean { return this.o.baseUrl !== null && Object.keys(this.o.grantKeys).length > 0; }

  private read(name: string): string | null { try { return this.o.storage.getItem(name); } catch { return null; } }
  private write(name: string, value: string | null): void {
    try { if (value === null) this.o.storage.removeItem(name); else this.o.storage.setItem(name, value); } catch { /* storage blocked: stays in memory only */ }
  }

  /**
   * A random id made on this device and kept in its storage, hashed. Not derived from the hardware, the person or
   * anything else about them; clearing the app's storage makes a new one (and uses a new slot).
   */
  async deviceHash(): Promise<string> {
    let id = this.read(DEVICE);
    if (!id) {
      id = this.o.randomId?.() ?? globalThis.crypto.randomUUID();
      this.write(DEVICE, id);
    }
    return sha256Hex(new TextEncoder().encode(`kestrel-device:${id}`) as Uint8Array<ArrayBuffer>);
  }

  private async keyHash(key: string) { return sha256Hex(new TextEncoder().encode(key.trim()) as Uint8Array<ArrayBuffer>); }

  /** The grant kept on this device for this key, checked again against the pinned keys and this device. */
  async storedStanding(key: string): Promise<OnlineStanding> {
    if (!this.configured) return { kind: 'not_set_up' };
    const keyHash = await this.keyHash(key);
    const revoked = this.read(REVOKED);
    if (revoked) {
      try { const r = JSON.parse(revoked) as { licenceKeyHash: string; message: string }; if (r.licenceKeyHash === keyHash) return { kind: 'revoked', message: r.message }; } catch { /* ignore */ }
    }
    const denied = this.read(DENIED);
    if (denied) {
      try {
        const r = JSON.parse(denied) as { licenceKeyHash: string; message: string };
        if (r.licenceKeyHash === keyHash) return { kind: 'device_limit', message: r.message };
      } catch { /* ignore damaged local record; never infer Pro without a signed grant */ }
    }
    const grant = await this.storedGrant(keyHash);
    return grant ? { kind: 'unreachable', grant: grant.grant, activationId: grant.activationId } : { kind: 'not_checked' };
  }

  private async storedGrant(keyHash: string): Promise<{ grant: EntitlementGrant; activationId: string } | null> {
    const raw = this.read(GRANT);
    if (!raw) return null;
    let stored: StoredGrant;
    try { stored = JSON.parse(raw) as StoredGrant; } catch { return null; }
    if (stored.licenceKeyHash !== keyHash) return null;
    const check = await verifyEntitlementGrant(stored.envelope, this.o.grantKeys, await this.deviceHash());
    return check.ok ? { grant: check.grant, activationId: stored.activationId } : null;
  }

  private async post(path: string, body: unknown, bearer?: string): Promise<{ status: number; json: Record<string, any> | null }> {
    const response = await this.o.fetch(`${this.o.baseUrl}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let json: Record<string, any> | null = null;
    try { json = await response.json() as Record<string, any>; } catch { json = null; }
    return { status: response.status, json };
  }

  /**
   * Activate (or renew) this device. Any network trouble keeps what was there: a stored grant stays in force until its
   * window ends; an already activated, never-revoked paid key keeps working locally when renewal is unavailable.
   */
  async activate(key: string): Promise<OnlineStanding> {
    if (!this.configured) return { kind: 'not_set_up' };
    const keyHash = await this.keyHash(key);
    const lastKnown = await this.storedStanding(key);
    const fallback = await this.storedGrant(keyHash);
    // If the last successful request explicitly blocked this key/device, a
    // network failure is NOT permission to revert to key-only Pro.
    const unreachable: OnlineStanding = lastKnown.kind === 'revoked' || lastKnown.kind === 'device_limit'
      ? lastKnown
      : { kind: 'unreachable', grant: fallback?.grant ?? null, activationId: fallback?.activationId ?? null };
    let reply: Awaited<ReturnType<LicenceSync['post']>>;
    try {
      reply = await this.post('/v1/licences/activate', { licenceKey: key.trim(), deviceHash: await this.deviceHash(), platform: this.o.platform, appVersion: this.o.appVersion });
    } catch { return unreachable; }
    const code = reply.json?.error?.code as string | undefined;
    const message = (reply.json?.error?.message as string | undefined) ?? '';
    if (reply.status === 403 && code === 'LICENCE_NOT_ACTIVE') {
      this.write(REVOKED, JSON.stringify({ licenceKeyHash: keyHash, message }));
      this.write(DENIED, null);
      this.write(GRANT, null);
      return { kind: 'revoked', message };
    }
    if (reply.status === 409 && code === 'DEVICE_LIMIT') {
      this.write(DENIED, JSON.stringify({ licenceKeyHash: keyHash, message }));
      // Prevent an obsolete grant from unlocking a device that was just denied.
      this.write(GRANT, null);
      return { kind: 'device_limit', message };
    }
    if (reply.status !== 200 || !reply.json) return unreachable;
    const check = await verifyEntitlementGrant(reply.json.grant, this.o.grantKeys, await this.deviceHash());
    // A grant that fails the pinned key is ignored, never trusted: as if the server could not be reached.
    if (!check.ok || typeof reply.json.activationId !== 'string') return unreachable;
    this.write(REVOKED, null);
    this.write(DENIED, null);
    this.write(GRANT, JSON.stringify({ envelope: reply.json.grant, activationId: reply.json.activationId, licenceKeyHash: keyHash } satisfies StoredGrant));
    return { kind: 'active', grant: check.grant, activationId: reply.json.activationId };
  }

  /** Whether an account grant is kept on this device at all, read synchronously and not yet checked (the splash uses it to wait for the check). */
  hasStoredAccountGrant(): boolean {
    return this.configured && this.read(ACCOUNT_GRANT) !== null;
  }

  /** The account grant kept on this device, checked again against the pinned keys and this device. Null when there is none. */
  async storedAccountStanding(): Promise<AccountStanding | null> {
    if (!this.configured) return null;
    const raw = this.read(ACCOUNT_GRANT);
    if (!raw) return null;
    try {
      const stored = JSON.parse(raw) as { envelope: unknown; activationId: string };
      const check = await verifyEntitlementGrant(stored.envelope, this.o.grantKeys, await this.deviceHash());
      return check.ok && typeof stored.activationId === 'string' ? { kind: 'active', grant: check.grant, activationId: stored.activationId } : null;
    } catch { return null; }
  }

  /**
   * Signed in: swap the Firebase ID token for a session, then ask for this device's grant. Signing in alone grants
   * nothing: with no purchase or gift on the account the answer is `no_licence` and the device stays Free. Null means
   * the server could not be reached (or answered something unexpected), so whatever was stored stays as it was.
   */
  async activateAccount(idToken: string): Promise<AccountStanding | null> {
    if (!this.configured) return null;
    const checkId = ++this.accountCheck;
    // A fresh exchange must not expose an older account's bearer to cloud operations.
    this.session = null;
    try {
      const stillThisCheck = () => checkId === this.accountCheck;
      const session = await this.postWaitingOutBusy('/v1/auth/firebase', { credential: idToken }, undefined, stillThisCheck);
      if (!session || checkId !== this.accountCheck || session.status !== 200 || typeof session.json?.accessToken !== 'string' || !session.json.accessToken.trim()) return null;
      const deviceHash = await this.deviceHash();
      if (checkId !== this.accountCheck) return null;
      this.session = session.json.accessToken;
      const reply = await this.postWaitingOutBusy('/v1/me/activate', { deviceHash, platform: this.o.platform, appVersion: this.o.appVersion }, session.json.accessToken, stillThisCheck);
      if (!reply) return null;
      if (checkId !== this.accountCheck) return null;
      const code = reply.json?.error?.code as string | undefined;
      const message = (reply.json?.error?.message as string | undefined) ?? '';
      if (reply.status === 403 && code === 'NO_LICENCE') { this.write(ACCOUNT_GRANT, null); return { kind: 'no_licence' }; }
      if (reply.status === 403 && code === 'LICENCE_NOT_ACTIVE') { this.write(ACCOUNT_GRANT, null); return { kind: 'revoked', message }; }
      if (reply.status === 409 && code === 'DEVICE_LIMIT') { this.write(ACCOUNT_GRANT, null); return { kind: 'device_limit', message }; }
      if (reply.status !== 200 || !reply.json) return null;
      const check = await verifyEntitlementGrant(reply.json.grant, this.o.grantKeys, await this.deviceHash());
      if (checkId !== this.accountCheck || !check.ok || typeof reply.json.activationId !== 'string') return null;
      this.write(ACCOUNT_GRANT, JSON.stringify({ envelope: reply.json.grant, activationId: reply.json.activationId }));
      const licenceKey = typeof reply.json.licenceKey === 'string' && reply.json.licenceKey.startsWith('KESTREL1.') ? reply.json.licenceKey : undefined;
      return { kind: 'active', grant: check.grant, activationId: reply.json.activationId, ...(licenceKey ? { licenceKey } : {}) };
    } catch { return null; }
  }

  /**
   * POST, and when the server answers "too many attempts" (429), wait and ask again (BUSY_WAITS_MS), so a sign-in
   * that lands in a busy minute still gets its answer. Null when the check was overtaken (sign-out, a newer check).
   */
  private async postWaitingOutBusy(path: string, body: unknown, bearer: string | undefined, stillCurrent: () => boolean) {
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt++) {
      if (!stillCurrent()) return null;
      const reply = await this.post(path, body, bearer);
      if (reply.status !== 429 || reply.json?.error?.code === 'RELEASE_LIMIT' || attempt >= BUSY_WAITS_MS.length) return reply;
      await sleep(BUSY_WAITS_MS[attempt]!);
    }
  }

  /** Device management uses a fresh verified identity, without activating or replacing the offline grant.
   * A sign-out or another activation invalidates an in-flight result. The bearer never leaves this method. */
  private async accountDeviceRequest(idToken: string, path: '/v1/me/devices' | '/v1/me/devices/deactivate', activationId?: string) {
    if (!this.configured || !idToken.trim()) return null;
    const checkId = this.accountCheck;
    try {
      const session = await this.post('/v1/auth/firebase', { credential: idToken });
      if (checkId !== this.accountCheck || session.status !== 200 || typeof session.json?.accessToken !== 'string' || !session.json.accessToken.trim()) return null;
      const deviceHash = await this.deviceHash();
      if (checkId !== this.accountCheck) return null;
      const reply = await this.post(path, { deviceHash, ...(activationId === undefined ? {} : { activationId }) }, session.json.accessToken);
      if (activationId !== undefined) this.noteRefusal(reply);
      return checkId === this.accountCheck && reply.status === 200 ? reply.json : null;
    } catch { return null; }
  }

  /**
   * Put this device's KESTREL1 key on the signed-in account (used before signing up). 'other' when another account
   * holds it: moving it is an account merge, never done here.
   */
  async attachKey(idToken: string, key: string): Promise<'attached' | 'already' | 'other' | 'invalid' | 'unreachable'> {
    if (!this.configured || !idToken.trim() || !key.trim()) return 'unreachable';
    try {
      const session = await this.post('/v1/auth/firebase', { credential: idToken });
      if (session.status !== 200 || typeof session.json?.accessToken !== 'string' || !session.json.accessToken.trim()) return 'unreachable';
      const reply = await this.post('/v1/me/licence/attach', { licenceKey: key.trim() }, session.json.accessToken);
      if (reply.status === 409) return 'other';
      if (reply.status === 400) return 'invalid';
      if (reply.status !== 200) return 'unreachable';
      return reply.json?.attached === true ? 'attached' : 'already';
    } catch { return 'unreachable'; }
  }

  async accountDevices(idToken: string): Promise<LicenceStatus | null> {
    const data = await this.accountDeviceRequest(idToken, '/v1/me/devices');
    if (!data || !['active', 'unknown'].includes(data.status) || !Number.isSafeInteger(data.maxDevices) || data.maxDevices < 0 ||
        (data.validUntilMs !== null && !Number.isSafeInteger(data.validUntilMs)) || !Array.isArray(data.devices)) return null;
    if (data.devices.some((d: unknown) => {
      if (!d || typeof d !== 'object') return true;
      const device = d as Partial<LicenceDevice>;
      return typeof device.activationId !== 'string' || !device.activationId || device.activationId.length > 64 ||
        typeof device.platform !== 'string' || typeof device.appVersion !== 'string' ||
        !Number.isSafeInteger(device.lastSeenMs) || typeof device.thisDevice !== 'boolean';
    })) return null;
    if (data.status === 'unknown' && (data.devices.length !== 0 || data.maxDevices !== 0)) return null;
    return { status: data.status, validUntilMs: data.validUntilMs, maxDevices: data.maxDevices, devices: data.devices };
  }

  async releaseAccountDevice(idToken: string, activationId: string): Promise<boolean> {
    if (!activationId || activationId.length > 64) return false;
    const result = await this.accountDeviceRequest(idToken, '/v1/me/devices/deactivate', activationId);
    return result?.deactivated === true;
  }

  /** The control-plane session used for buying Pro. Exchanged from a fresh Firebase ID token; memory only. */
  private checkoutSession: string | null = null;

  private async checkoutBearer(idToken: string, fresh: boolean): Promise<string | null> {
    if (this.checkoutSession && !fresh) return this.checkoutSession;
    const session = await this.post('/v1/auth/firebase', { credential: idToken });
    const token = session.status === 200 && typeof session.json?.accessToken === 'string' && session.json.accessToken.trim() ? session.json.accessToken as string : null;
    this.checkoutSession = token;
    return token;
  }

  private async get(path: string, bearer: string): Promise<{ status: number; json: Record<string, any> | null }> {
    const response = await this.o.fetch(`${this.o.baseUrl}${path}`, { method: 'GET', headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    let json: Record<string, any> | null = null;
    try { json = await response.json() as Record<string, any>; } catch { json = null; }
    return { status: response.status, json };
  }

  /**
   * Start buying Pro for the signed-in account: the server opens a Paddle transaction bound to the account and returns
   * our checkout page for it. Paddle asks for the country and adds the right tax. Never charges anything by itself.
   */
  async startProCheckout(idToken: string): Promise<CheckoutStart> {
    if (!this.configured) return { ok: false, code: 'NOT_SET_UP', message: checkoutErrorText('NOT_SET_UP') };
    const checkId = this.accountCheck;
    try {
      const bearer = await this.checkoutBearer(idToken, true);
      if (!bearer || checkId !== this.accountCheck) return { ok: false, code: 'ACCOUNT_UNVERIFIED', message: checkoutErrorText('ACCOUNT_UNVERIFIED') };
      const reply = await this.post('/v1/me/checkout/pro', {}, bearer);
      if (checkId !== this.accountCheck) return { ok: false, code: 'NOT_SIGNED_IN', message: checkoutErrorText('NOT_SIGNED_IN') };
      return parseCheckoutStart(reply.status, reply.json);
    } catch {
      return { ok: false, code: 'UNREACHABLE', message: checkoutErrorText('UNREACHABLE') };
    }
  }

  /** Has this checkout been paid and verified with Paddle? Network trouble or an expired session is "retry", never "paid". */
  async proCheckoutStatus(idToken: string, checkoutId: string): Promise<CheckoutPoll> {
    if (!this.configured || !CHECKOUT_ID.test(checkoutId)) return 'gone';
    const checkId = this.accountCheck;
    try {
      let bearer = await this.checkoutBearer(idToken, false);
      if (!bearer) return 'retry';
      let reply = await this.get(`/v1/me/checkout/pro/${encodeURIComponent(checkoutId)}`, bearer);
      if (reply.status === 401) {
        bearer = await this.checkoutBearer(idToken, true);
        if (!bearer) return 'retry';
        reply = await this.get(`/v1/me/checkout/pro/${encodeURIComponent(checkoutId)}`, bearer);
      }
      if (checkId !== this.accountCheck) return 'gone';
      return parseCheckoutPoll(reply.status, reply.json);
    } catch { return 'retry'; }
  }

  /** Signing out forgets the account grant on this device. (The slot can be freed from another signed-in device.) */
  forgetAccount(): void {
    ++this.accountCheck;
    this.session = null;
    this.checkoutSession = null;
    this.write(ACCOUNT_GRANT, null);
  }

  /** The key's status and devices, or null when the server cannot be reached. */
  async status(key: string): Promise<LicenceStatus | null> {
    if (!this.configured) return null;
    try {
      const reply = await this.post('/v1/licences/status', { licenceKey: key.trim(), deviceHash: await this.deviceHash() });
      return reply.status === 200 && reply.json ? reply.json as LicenceStatus : null;
    } catch { return null; }
  }

  /** Free one of the key's device slots. Freeing this device also forgets its grant. */
  async deactivate(key: string, activationId: string): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const reply = await this.post('/v1/licences/deactivate', { licenceKey: key.trim(), activationId });
      this.noteRefusal(reply);
      if (reply.status !== 200) return false;
      const stored = await this.storedGrant(await this.keyHash(key));
      if (stored?.activationId === activationId) this.write(GRANT, null);
      // A freed slot permits reactivation after a prior known device-limit denial.
      this.write(DENIED, null);
      return true;
    } catch { return false; }
  }

  /** Forget everything about the key on this device (the device id stays, so a re-entered key reuses its slot). */
  forget(): void { this.write(GRANT, null); this.write(REVOKED, null); this.write(DENIED, null); }

  /**
   * When this key was first used on this device, recorded now if it never was. Null for builds with no licence service,
   * which never ask a device to register. Removing the key keeps the record, so pasting it again does not restart it.
   */
  async firstUse(key: string, nowMs: number): Promise<number | null> {
    if (!this.configured) return null;
    const hash = await this.keyHash(key);
    let seen: Record<string, number> = {};
    try { seen = JSON.parse(this.read(FIRST_USE) ?? '{}') as Record<string, number>; } catch { /* damaged: start again */ }
    const at = seen[hash];
    if (Number.isSafeInteger(at) && at <= nowMs) return at;
    seen = { ...Object.fromEntries(Object.entries(seen).slice(-9)), [hash]: nowMs };
    this.write(FIRST_USE, JSON.stringify(seen));
    return nowMs;
  }
}
