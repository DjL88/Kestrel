import { uuid } from './crypto.ts';
import {
  clipAuditDetail, extendedUntil, licenceAfterBillingEvent, licenceIsUsable, newLicence, QUOTA_DEFAULT_LIMIT,
  type AccountRecord, type ActivationOutcome, type ActivationRecord, type BillingEventRecord, type ContactMessageRecord, type ContactStatus, type Role, type ActivationRequest, type AuditRecord, type BillingEvent, type LicenceRecord,
  type LicenceStatus, type ModelAssetRecord, type QuotaRecord, type ReleaseRecord, type Store,
} from './store.ts';

// ---- The part of the @google-cloud/firestore API this store uses ---------------------------------------------------
// Written structurally so the real client (production, emulator) and the in-memory fake (test/memoryFirestore.ts) both
// fit, and so nothing outside server start-up needs the Google package installed.

export type FsData = Record<string, unknown>;
export interface FsDocSnapshot { readonly exists: boolean; readonly id: string; data(): FsData | undefined }
export interface FsQuerySnapshot { readonly docs: FsDocSnapshot[]; readonly size: number; readonly empty: boolean }
export interface FsQuery {
  where(field: string, op: '==', value: unknown): FsQuery;
  orderBy(field: string, direction?: 'asc' | 'desc'): FsQuery;
  limit(n: number): FsQuery;
  get(): Promise<FsQuerySnapshot>;
  count(): { get(): Promise<{ data(): { count: number } }> };
}
export interface FsDocRef {
  readonly id: string;
  get(): Promise<FsDocSnapshot>;
  set(data: FsData): Promise<unknown>;
  create(data: FsData): Promise<unknown>;
}
export interface FsCollection extends FsQuery { doc(id: string): FsDocRef }
export interface FsTransaction {
  get(ref: FsDocRef): Promise<FsDocSnapshot>;
  get(query: FsQuery): Promise<FsQuerySnapshot>;
  set(ref: FsDocRef, data: FsData): FsTransaction;
  create(ref: FsDocRef, data: FsData): FsTransaction;
  update(ref: FsDocRef, data: FsData): FsTransaction;
  delete(ref: FsDocRef): FsTransaction;
}
export interface FirestoreLike {
  collection(path: string): FsCollection;
  runTransaction<T>(body: (tx: FsTransaction) => Promise<T>): Promise<T>;
  terminate(): Promise<void>;
}

/** gRPC status Firestore uses when create() finds the document already there. */
export const ALREADY_EXISTS = 6;
const alreadyExists = (error: unknown) => (error as { code?: unknown })?.code === ALREADY_EXISTS;

/** Composite document ids. encodeURIComponent escapes '/' (not allowed in ids) and the '|' separator itself. */
export const docId = (...parts: string[]) => parts.map(encodeURIComponent).join('|');

/** Orders audit entries written in the same millisecond, newest first, with one single-field index. */
let auditSequence = 0;
const auditSortKey = (atMs: number) => `${String(atMs).padStart(15, '0')}-${String(++auditSequence % 1e9).padStart(9, '0')}-${uuid()}`;

const C = {
  accounts: 'accounts',
  emails: 'account_emails',
  refresh: 'refresh_tokens',
  licences: 'licences',
  activations: 'device_activations',
  quotas: 'ai_usage_quotas',
  billing: 'billing_events',
  assets: 'model_assets',
  releases: 'desktop_releases',
  settings: 'settings',
  audit: 'audit_log',
  contact: 'contact_messages',
} as const;

// Licence documents carry one extra field, deviceCount, so a transaction can check the slot limit by reading a single
// document (two devices activating at once then contend on it and are serialised, instead of both counting 2 of 3).
const toLicence = (d: FsData): LicenceRecord => ({
  licenceId: d.licenceId as string, accountId: (d.accountId as string | null) ?? null, plan: d.plan as LicenceRecord['plan'],
  managedAi: d.managedAi === true, status: d.status as LicenceStatus, maxDevices: d.maxDevices as number,
  offlineGraceDays: d.offlineGraceDays as number, validUntilMs: (d.validUntilMs as number | null) ?? null, updatedAtMs: d.updatedAtMs as number,
  note: typeof d.note === 'string' ? d.note : null,
  majorVersion: typeof d.majorVersion === 'number' ? d.majorVersion : 1, paid: d.paid === true,
  source: d.source === 'purchase' || d.source === 'gift' ? d.source : 'key', emailHash: typeof d.emailHash === 'string' ? d.emailHash : null,
});
const licenceDoc = (l: LicenceRecord, deviceCount: number): FsData => ({ ...l, deviceCount });
const deviceCountOf = (d: FsData | undefined) => (typeof d?.deviceCount === 'number' ? d.deviceCount : 0);
const toQuota = (d: FsData): QuotaRecord => ({ accountId: d.accountId as string, periodStartMs: d.periodStartMs as number, requestsUsed: d.requestsUsed as number, requestsLimit: d.requestsLimit as number });

/**
 * Google Cloud Firestore (native mode). Used on Cloud Run. Every multi-step operation runs in a Firestore transaction
 * with all reads before any write, which Firestore requires and the in-memory fake enforces.
 *
 * Queries use equality filters only, or one orderBy on its own, so no composite index is needed.
 */
export class FirestoreStore implements Store {
  readonly kind = 'firestore' as const;
  constructor(private readonly db: FirestoreLike) {}

  private ref(collection: string, id: string) { return this.db.collection(collection).doc(id); }

  async createAccount(a: AccountRecord): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const email = await tx.get(this.ref(C.emails, a.emailHash));
      if (email.exists) return false;
      tx.create(this.ref(C.emails, a.emailHash), { accountId: a.accountId });
      tx.create(this.ref(C.accounts, a.accountId), { ...a });
      return true;
    });
  }
  async getAccount(accountId: string) {
    const snap = await this.ref(C.accounts, accountId).get();
    if (!snap.exists) return undefined;
    const data = snap.data() as unknown as AccountRecord;
    // aiConsent defaults to false for accounts written before this field existed.
    return { ...data, aiConsent: data.aiConsent ?? false };
  }
  async setAccountRole(accountId: string, role: Role): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.accounts, accountId);
      if ((await tx.get(ref)).exists) tx.update(ref, { role });
    });
  }
  async setAiConsent(accountId: string, consent: boolean): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.accounts, accountId);
      if ((await tx.get(ref)).exists) tx.update(ref, { aiConsent: consent });
    });
  }
  async findAccountByEmailHash(emailHash: string) {
    const snap = await this.ref(C.emails, emailHash).get();
    return snap.exists ? this.getAccount(snap.data()!.accountId as string) : undefined;
  }
  async addRefreshToken(tokenHash: string, accountId: string, expiresAtMs: number): Promise<void> {
    await this.ref(C.refresh, tokenHash).create({ accountId, expiresAtMs, used: false });
  }
  async consumeRefreshToken(tokenHash: string, nowMs: number): Promise<string | undefined> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.refresh, tokenHash);
      const snap = await tx.get(ref);
      const d = snap.data();
      if (!snap.exists || !d || d.used === true || (d.expiresAtMs as number) <= nowMs) return undefined;
      tx.update(ref, { used: true });
      return d.accountId as string;
    });
  }

  async insertLicence(l: LicenceRecord): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.licences, l.licenceId);
      const current = await tx.get(ref);
      tx.set(ref, licenceDoc(l, deviceCountOf(current.data())));
    });
  }
  async grantLicence(l: LicenceRecord) {
    return this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.licences, l.licenceId);
      const current = await tx.get(ref);
      if (current.exists) return { created: false, licence: toLicence(current.data()!) };
      tx.set(ref, licenceDoc(l, 0));
      return { created: true, licence: l };
    });
  }
  async claimLicencesForEmail(emailHash: string, accountId: string) {
    const snap = await this.db.collection(C.licences).where('emailHash', '==', emailHash).get();
    let claimed = 0;
    for (const doc of snap.docs) {
      // Re-read inside a transaction so two sign-ins racing cannot both take the same licence.
      claimed += await this.db.runTransaction(async (tx) => {
        const ref = this.ref(C.licences, doc.id);
        const current = await tx.get(ref);
        if (!current.exists || (current.data()!.accountId ?? null) !== null) return 0;
        tx.update(ref, { accountId });
        return 1;
      });
    }
    return claimed;
  }
  async getLicence(licenceId: string) {
    const snap = await this.ref(C.licences, licenceId).get();
    return snap.exists ? toLicence(snap.data()!) : undefined;
  }
  async listLicencesForAccount(accountId: string) {
    const snap = await this.db.collection(C.licences).where('accountId', '==', accountId).get();
    return snap.docs.map((d) => toLicence(d.data()!)).sort((a, b) => a.licenceId.localeCompare(b.licenceId));
  }
  async hasActiveManagedAi(accountId: string) {
    return (await this.listLicencesForAccount(accountId)).some((l) => l.managedAi && l.status === 'active');
  }

  async activateDevice(r: ActivationRequest): Promise<ActivationOutcome> {
    return this.db.runTransaction(async (tx): Promise<ActivationOutcome> => {
      const licenceRef = this.ref(C.licences, r.licenceId);
      const activationRef = this.ref(C.activations, docId(r.licenceId, r.deviceHash));
      const [licenceSnap, activationSnap] = [await tx.get(licenceRef), await tx.get(activationRef)];
      const current = licenceSnap.exists ? toLicence(licenceSnap.data()!) : newLicence(r.licenceId, r.planIfNew, r.nowMs);
      let deviceCount = deviceCountOf(licenceSnap.data());
      if (!licenceIsUsable(current, r.nowMs)) {
        if (!licenceSnap.exists) tx.create(licenceRef, licenceDoc(current, 0));
        return { ok: false, reason: 'not_active' };
      }
      if (activationSnap.exists) {
        tx.update(activationRef, { lastSeenMs: r.nowMs, appVersion: r.appVersion });
        if (!licenceSnap.exists) tx.create(licenceRef, licenceDoc(current, deviceCount));
        return { ok: true, activationId: activationSnap.data()!.activationId as string, licence: current };
      }
      if (deviceCount >= current.maxDevices) {
        if (!licenceSnap.exists) tx.create(licenceRef, licenceDoc(current, deviceCount));
        return { ok: false, reason: 'device_limit', maxDevices: current.maxDevices };
      }
      deviceCount += 1;
      tx.create(activationRef, { activationId: r.newActivationId, licenceId: r.licenceId, deviceHash: r.deviceHash, platform: r.platform, appVersion: r.appVersion, lastSeenMs: r.nowMs });
      tx.set(licenceRef, licenceDoc(current, deviceCount));
      return { ok: true, activationId: r.newActivationId, licence: current };
    });
  }
  async setLicenceStatus(licenceId: string, status: LicenceStatus, nowMs: number): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.licences, licenceId);
      if (!(await tx.get(ref)).exists) return false;
      tx.update(ref, { status, updatedAtMs: nowMs });
      return true;
    });
  }
  async extendLicence(licenceId: string, days: number, nowMs: number): Promise<number | undefined> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.licences, licenceId);
      const snap = await tx.get(ref);
      if (!snap.exists) return undefined;
      const until = extendedUntil(toLicence(snap.data()!).validUntilMs, days, nowMs);
      tx.update(ref, { validUntilMs: until, status: 'active', updatedAtMs: nowMs });
      return until;
    });
  }

  async listLicences(limit: number) {
    const snap = await this.db.collection(C.licences).orderBy('updatedAtMs', 'desc').limit(limit).get();
    return snap.docs.map((d) => toLicence(d.data()!));
  }
  async listActivations(limit: number) {
    const snap = await this.db.collection(C.activations).orderBy('lastSeenMs', 'desc').limit(limit).get();
    return snap.docs.map((d) => d.data() as unknown as ActivationRecord);
  }
  async listActivationsForLicence(licenceId: string) {
    const snap = await this.db.collection(C.activations).where('licenceId', '==', licenceId).get();
    return snap.docs.map((d) => d.data() as unknown as ActivationRecord).sort((a, b) => b.lastSeenMs - a.lastSeenMs);
  }
  async deactivateDevice(activationId: string): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const found = await tx.get(this.db.collection(C.activations).where('activationId', '==', activationId));
      if (found.empty) return false;
      const doc = found.docs[0];
      const licenceRef = this.ref(C.licences, doc.data()!.licenceId as string);
      const licenceSnap = await tx.get(licenceRef);
      tx.delete(this.ref(C.activations, doc.id));
      if (licenceSnap.exists) tx.update(licenceRef, { deviceCount: Math.max(deviceCountOf(licenceSnap.data()) - 1, 0) });
      return true;
    });
  }

  async reserveQuota(accountId: string, nowMs: number, periodMs: number): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.quotas, accountId);
      const snap = await tx.get(ref);
      let quota = snap.exists ? toQuota(snap.data()!) : { accountId, periodStartMs: nowMs, requestsUsed: 0, requestsLimit: QUOTA_DEFAULT_LIMIT };
      if (nowMs - quota.periodStartMs >= periodMs) quota = { ...quota, periodStartMs: nowMs, requestsUsed: 0 };
      const granted = quota.requestsUsed < quota.requestsLimit;
      if (granted) quota = { ...quota, requestsUsed: quota.requestsUsed + 1 };
      tx.set(ref, { ...quota });
      return granted;
    });
  }
  async refundQuota(accountId: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.quotas, accountId);
      const snap = await tx.get(ref);
      if (snap.exists) tx.update(ref, { requestsUsed: Math.max(toQuota(snap.data()!).requestsUsed - 1, 0) });
    });
  }
  async getQuota(accountId: string) {
    const snap = await this.ref(C.quotas, accountId).get();
    return snap.exists ? toQuota(snap.data()!) : undefined;
  }
  async setQuotaLimit(accountId: string, requestsLimit: number, nowMs: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.quotas, accountId);
      const snap = await tx.get(ref);
      if (snap.exists) tx.update(ref, { requestsLimit });
      else tx.create(ref, { accountId, periodStartMs: nowMs, requestsUsed: 0, requestsLimit });
    });
  }

  async listQuotas(limit: number) {
    const snap = await this.db.collection(C.quotas).orderBy('periodStartMs', 'desc').limit(limit).get();
    return snap.docs.map((d) => toQuota(d.data()!));
  }

  async applyBillingEvent(event: BillingEvent, nowMs: number): Promise<'applied' | 'replayed'> {
    return this.db.runTransaction(async (tx) => {
      const eventRef = this.ref(C.billing, event.id);
      const licenceRef = this.ref(C.licences, event.data.licenceId);
      const [eventSnap, licenceSnap] = [await tx.get(eventRef), await tx.get(licenceRef)];
      if (eventSnap.exists) return 'replayed' as const;
      tx.create(eventRef, { eventType: event.type, receivedAtMs: nowMs });
      const next = licenceAfterBillingEvent(event, licenceSnap.exists ? toLicence(licenceSnap.data()!) : undefined, nowMs);
      if (next) tx.set(licenceRef, licenceDoc(next, deviceCountOf(licenceSnap.data())));
      return 'applied' as const;
    });
  }

  async listBillingEvents(limit: number): Promise<BillingEventRecord[]> {
    const snap = await this.db.collection(C.billing).orderBy('receivedAtMs', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ eventId: d.id, eventType: d.data()!.eventType as string, receivedAtMs: d.data()!.receivedAtMs as number }));
  }

  async insertModelAsset(a: ModelAssetRecord): Promise<boolean> {
    try { await this.ref(C.assets, docId(a.assetId, a.version, a.channel)).create({ ...a }); return true; } catch (error) { if (alreadyExists(error)) return false; throw error; }
  }
  async listLiveModelAssets(channel: string) {
    const snap = await this.db.collection(C.assets).where('channel', '==', channel).where('status', '==', 'live').get();
    return snap.docs.map((d) => d.data() as unknown as ModelAssetRecord).sort((a, b) => a.assetId.localeCompare(b.assetId));
  }
  async getModelAsset(assetId: string, version: string, channel: string) {
    const snap = await this.ref(C.assets, docId(assetId, version, channel)).get();
    return snap.exists ? (snap.data() as unknown as ModelAssetRecord) : undefined;
  }
  async promoteModelAsset(assetId: string, version: string, channel: string): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const target = this.ref(C.assets, docId(assetId, version, channel));
      const revisionRef = this.ref(C.settings, `manifest_revision_${channel}`);
      const targetSnap = await tx.get(target);
      const live = await tx.get(this.db.collection(C.assets).where('assetId', '==', assetId).where('channel', '==', channel).where('status', '==', 'live'));
      const revisionSnap = await tx.get(revisionRef);
      if (!targetSnap.exists) return false;
      for (const doc of live.docs) if (doc.id !== target.id) tx.update(this.ref(C.assets, doc.id), { status: 'retired' });
      tx.update(target, { status: 'live' });
      tx.set(revisionRef, { value: String(Number(revisionSnap.data()?.value ?? 1) + 1) });
      return true;
    });
  }
  async insertRelease(r: ReleaseRecord): Promise<boolean> {
    try { await this.ref(C.releases, docId(r.platform, r.channel, r.version)).create({ ...r }); return true; } catch (error) { if (alreadyExists(error)) return false; throw error; }
  }
  async listReleases(platform: string, channel: string) {
    const snap = await this.db.collection(C.releases).where('platform', '==', platform).where('channel', '==', channel).get();
    return snap.docs.map((d) => d.data() as unknown as ReleaseRecord);
  }

  async insertContactMessage(m: ContactMessageRecord): Promise<void> { await this.ref(C.contact, m.messageId).create({ ...m }); }
  async listContactMessages(limit: number) {
    const snap = await this.db.collection(C.contact).orderBy('receivedAtMs', 'desc').limit(limit).get();
    return snap.docs.map((d) => d.data() as unknown as ContactMessageRecord);
  }
  async setContactMessageStatus(messageId: string, status: ContactStatus): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.ref(C.contact, messageId);
      if (!(await tx.get(ref)).exists) return false;
      tx.update(ref, { status });
      return true;
    });
  }

  async getSetting(name: string) {
    const snap = await this.ref(C.settings, name).get();
    return snap.exists ? (snap.data()!.value as string) : undefined;
  }
  async setSetting(name: string, value: string): Promise<void> { await this.ref(C.settings, name).set({ value }); }
  async counts() {
    const n = async (c: string) => (await this.db.collection(c).count().get()).data().count;
    const [accounts, licences, activations] = await Promise.all([n(C.accounts), n(C.licences), n(C.activations)]);
    return { accounts, licences, activations };
  }
  async audit(e: AuditRecord): Promise<void> {
    await this.ref(C.audit, uuid()).create({ ...e, detail: clipAuditDetail(e.detail), sortKey: auditSortKey(e.atMs) });
  }
  async listAudit(limit: number): Promise<AuditRecord[]> {
    const snap = await this.db.collection(C.audit).orderBy('sortKey', 'desc').limit(limit).get();
    return snap.docs.map((d) => { const x = d.data()!; return { atMs: x.atMs as number, actor: x.actor as string, action: x.action as string, outcome: x.outcome as AuditRecord['outcome'], detail: x.detail as string }; });
  }

  async close(): Promise<void> { await this.db.terminate(); }
}
