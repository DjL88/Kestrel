/**
 * Talks to the control plane about this device's licence: activate (and renew), list the key's devices, free one.
 * Everything it needs is passed in, so the same code runs in the app (licenceStore.ts) and in tests against a real
 * control plane. It never sends anything but the key, a random per-device hash, the platform and the app version.
 */
import { verifyEntitlementGrant, type EntitlementGrant } from '../core/entitlementGrant';
import { type KestrelPlatform, type OnlineStanding } from '../core/licenceOnline';
import { sha256Hex, type PinnedKeys } from '../core/signedEnvelope';

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
}

export interface LicenceDevice { activationId: string; platform: string; appVersion: string; lastSeenMs: number; thisDevice: boolean }
export interface LicenceStatus { status: 'active' | 'revoked' | 'expired' | 'unknown'; validUntilMs: number | null; maxDevices: number; devices: LicenceDevice[] }

const DEVICE = 'kestrel.device.v1';
const GRANT = 'kestrel.licence.grant.v1';
const REVOKED = 'kestrel.licence.revoked.v1';
const DENIED = 'kestrel.licence.denied.v1';
const TIMEOUT_MS = 12_000;

interface StoredGrant { envelope: unknown; activationId: string; licenceKeyHash: string }

export class LicenceSync {
  constructor(private readonly o: LicenceSyncOptions) {}

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

  private async post(path: string, body: unknown): Promise<{ status: number; json: Record<string, any> | null }> {
    const response = await this.o.fetch(`${this.o.baseUrl}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
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
    const fallback = await this.storedGrant(keyHash);
    const unreachable: OnlineStanding = { kind: 'unreachable', grant: fallback?.grant ?? null, activationId: fallback?.activationId ?? null };
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
}
