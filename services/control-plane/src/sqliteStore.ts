import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { uuid } from './crypto.ts';
import {
  clipAuditDetail, extendedUntil, licenceAfterBillingEvent, licenceIsUsable, newLicence,
  type AccountRecord, type ActivationOutcome, type ActivationRecord, type BillingEventRecord, type ContactMessageRecord, type ContactStatus, type Role, type ActivationRequest, type AuditRecord, type BillingEvent, type LicenceRecord,
  type LicenceStatus, type ModelAssetRecord, type QuotaRecord, type ReleaseRecord, type Store,
} from './store.ts';

type Value = string | number | null;

interface LicenceRow { licence_id: string; account_id: string | null; plan: LicenceRecord['plan']; managed_ai: number; status: LicenceStatus; max_devices: number; offline_grace_days: number; valid_until_ms: number | null; updated_at_ms: number; note: string | null }
interface AccountRow { account_id: string; email_hash: string; password_hash: string; role: AccountRecord['role']; status: AccountRecord['status']; created_at_ms: number }
interface AssetRow { asset_id: string; kind: string; version: string; channel: string; path: string; sha256: string; bytes: number; required_app_min: string; status: ModelAssetRecord['status']; created_at_ms: number }

const licence = (r: LicenceRow): LicenceRecord => ({
  licenceId: r.licence_id, accountId: r.account_id, plan: r.plan, managedAi: r.managed_ai === 1, status: r.status,
  maxDevices: r.max_devices, offlineGraceDays: r.offline_grace_days, validUntilMs: r.valid_until_ms, updatedAtMs: r.updated_at_ms, note: r.note ?? null,
});
const account = (r: AccountRow): AccountRecord => ({ accountId: r.account_id, emailHash: r.email_hash, passwordHash: r.password_hash, role: r.role, status: r.status, createdAtMs: r.created_at_ms });
const asset = (r: AssetRow): ModelAssetRecord => ({
  assetId: r.asset_id, kind: r.kind, version: r.version, channel: r.channel, path: r.path, sha256: r.sha256, bytes: r.bytes,
  requiredAppMin: r.required_app_min, status: r.status, createdAtMs: r.created_at_ms,
});
const isConstraint = (error: unknown) => /constraint/i.test(String((error as Error)?.message));

/**
 * SQLite through node:sqlite (no native install on Windows): local development and tests.
 *
 * node:sqlite is synchronous, and every method below does all its work before its first await, so no two
 * operations interleave. That, plus BEGIN IMMEDIATE around multi-statement work, keeps the counters race-safe.
 */
export class SqliteStore implements Store {
  readonly kind = 'sqlite' as const;
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    // Databases made before licences had a note.
    const columns = this.all<{ name: string }>('PRAGMA table_info(licences)').map((c) => c.name);
    if (!columns.includes('note')) this.db.exec('ALTER TABLE licences ADD COLUMN note TEXT');
  }

  private get<T>(sql: string, ...params: Value[]): T | undefined { return this.db.prepare(sql).get(...params) as T | undefined; }
  private all<T>(sql: string, ...params: Value[]): T[] { return this.db.prepare(sql).all(...params) as T[]; }
  private run(sql: string, ...params: Value[]): number { return Number(this.db.prepare(sql).run(...params).changes); }
  private transaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = body(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private writeLicence(l: LicenceRecord): void {
    this.run(`INSERT INTO licences (licence_id, account_id, plan, managed_ai, status, max_devices, offline_grace_days, valid_until_ms, updated_at_ms, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (licence_id) DO UPDATE SET account_id = excluded.account_id, plan = excluded.plan,
      managed_ai = excluded.managed_ai, status = excluded.status, max_devices = excluded.max_devices, offline_grace_days = excluded.offline_grace_days,
      valid_until_ms = excluded.valid_until_ms, updated_at_ms = excluded.updated_at_ms, note = excluded.note`,
    l.licenceId, l.accountId, l.plan, l.managedAi ? 1 : 0, l.status, l.maxDevices, l.offlineGraceDays, l.validUntilMs, l.updatedAtMs, l.note);
  }
  private readLicence(licenceId: string): LicenceRecord | undefined {
    const row = this.get<LicenceRow>('SELECT * FROM licences WHERE licence_id = ?', licenceId);
    return row && licence(row);
  }

  async createAccount(a: AccountRecord): Promise<boolean> {
    try {
      this.run('INSERT INTO accounts (account_id, email_hash, password_hash, role, status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)',
        a.accountId, a.emailHash, a.passwordHash, a.role, a.status, a.createdAtMs);
      return true;
    } catch (error) { if (isConstraint(error)) return false; throw error; }
  }
  async getAccount(accountId: string) { const r = this.get<AccountRow>('SELECT * FROM accounts WHERE account_id = ?', accountId); return r && account(r); }
  async setAccountRole(accountId: string, role: Role): Promise<void> { this.run('UPDATE accounts SET role = ? WHERE account_id = ?', role, accountId); }
  async findAccountByEmailHash(emailHash: string) { const r = this.get<AccountRow>('SELECT * FROM accounts WHERE email_hash = ?', emailHash); return r && account(r); }

  async addRefreshToken(tokenHash: string, accountId: string, expiresAtMs: number): Promise<void> {
    this.run('INSERT INTO refresh_tokens (token_hash, account_id, expires_at_ms) VALUES (?, ?, ?)', tokenHash, accountId, expiresAtMs);
  }
  async consumeRefreshToken(tokenHash: string, nowMs: number): Promise<string | undefined> {
    return this.transaction(() => {
      const found = this.get<{ account_id: string; expires_at_ms: number; revoked: number }>('SELECT account_id, expires_at_ms, revoked FROM refresh_tokens WHERE token_hash = ?', tokenHash);
      if (!found || found.revoked || found.expires_at_ms <= nowMs) return undefined;
      this.run('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', tokenHash);
      return found.account_id;
    });
  }

  async insertLicence(l: LicenceRecord): Promise<void> { this.writeLicence(l); }
  async getLicence(licenceId: string) { return this.readLicence(licenceId); }
  async listLicencesForAccount(accountId: string) { return this.all<LicenceRow>('SELECT * FROM licences WHERE account_id = ? ORDER BY licence_id', accountId).map(licence); }
  async hasActiveManagedAi(accountId: string) { return !!this.get('SELECT 1 FROM licences WHERE account_id = ? AND managed_ai = 1 AND status = \'active\'', accountId); }

  async activateDevice(r: ActivationRequest): Promise<ActivationOutcome> {
    return this.transaction(() => {
      let current = this.readLicence(r.licenceId);
      if (!current) { current = newLicence(r.licenceId, r.planIfNew, r.nowMs); this.writeLicence(current); }
      if (!licenceIsUsable(current, r.nowMs)) return { ok: false, reason: 'not_active' };
      const existing = this.get<{ activation_id: string }>('SELECT activation_id FROM device_activations WHERE licence_id = ? AND device_hash = ?', r.licenceId, r.deviceHash);
      if (existing) {
        this.run('UPDATE device_activations SET last_seen_ms = ?, app_version = ? WHERE activation_id = ?', r.nowMs, r.appVersion, existing.activation_id);
        return { ok: true, activationId: existing.activation_id, licence: current };
      }
      const used = this.get<{ n: number }>('SELECT COUNT(*) AS n FROM device_activations WHERE licence_id = ?', r.licenceId)!.n;
      if (used >= current.maxDevices) return { ok: false, reason: 'device_limit', maxDevices: current.maxDevices };
      this.run('INSERT INTO device_activations (activation_id, licence_id, device_hash, platform, app_version, last_seen_ms) VALUES (?, ?, ?, ?, ?, ?)',
        r.newActivationId, r.licenceId, r.deviceHash, r.platform, r.appVersion, r.nowMs);
      return { ok: true, activationId: r.newActivationId, licence: current };
    });
  }
  async setLicenceStatus(licenceId: string, status: LicenceStatus, nowMs: number) {
    return this.run('UPDATE licences SET status = ?, updated_at_ms = ? WHERE licence_id = ?', status, nowMs, licenceId) === 1;
  }
  async extendLicence(licenceId: string, days: number, nowMs: number) {
    return this.transaction(() => {
      const current = this.readLicence(licenceId);
      if (!current) return undefined;
      const until = extendedUntil(current.validUntilMs, days, nowMs);
      this.run('UPDATE licences SET valid_until_ms = ?, status = \'active\', updated_at_ms = ? WHERE licence_id = ?', until, nowMs, licenceId);
      return until;
    });
  }

  async listLicences(limit: number) { return this.all<LicenceRow>('SELECT * FROM licences ORDER BY updated_at_ms DESC, rowid DESC LIMIT ?', limit).map(licence); }
  async listActivations(limit: number): Promise<ActivationRecord[]> {
    return this.all<{ activation_id: string; licence_id: string; device_hash: string; platform: string; app_version: string; last_seen_ms: number }>(
      'SELECT * FROM device_activations ORDER BY last_seen_ms DESC, rowid DESC LIMIT ?', limit)
      .map((r) => ({ activationId: r.activation_id, licenceId: r.licence_id, deviceHash: r.device_hash, platform: r.platform, appVersion: r.app_version, lastSeenMs: r.last_seen_ms }));
  }
  async deactivateDevice(activationId: string) { return this.run('DELETE FROM device_activations WHERE activation_id = ?', activationId) === 1; }

  async reserveQuota(accountId: string, nowMs: number, periodMs: number): Promise<boolean> {
    return this.transaction(() => {
      const row = this.get<{ period_start_ms: number }>('SELECT period_start_ms FROM ai_usage_quotas WHERE account_id = ?', accountId);
      if (!row) this.run('INSERT INTO ai_usage_quotas (account_id, period_start_ms) VALUES (?, ?)', accountId, nowMs);
      else if (nowMs - row.period_start_ms >= periodMs) this.run('UPDATE ai_usage_quotas SET period_start_ms = ?, requests_used = 0 WHERE account_id = ?', nowMs, accountId);
      return this.run('UPDATE ai_usage_quotas SET requests_used = requests_used + 1 WHERE account_id = ? AND requests_used < requests_limit', accountId) === 1;
    });
  }
  async refundQuota(accountId: string): Promise<void> {
    this.run('UPDATE ai_usage_quotas SET requests_used = MAX(requests_used - 1, 0) WHERE account_id = ?', accountId);
  }
  async getQuota(accountId: string): Promise<QuotaRecord | undefined> {
    const r = this.get<{ period_start_ms: number; requests_used: number; requests_limit: number }>('SELECT period_start_ms, requests_used, requests_limit FROM ai_usage_quotas WHERE account_id = ?', accountId);
    return r && { accountId, periodStartMs: r.period_start_ms, requestsUsed: r.requests_used, requestsLimit: r.requests_limit };
  }
  async setQuotaLimit(accountId: string, requestsLimit: number, nowMs: number): Promise<void> {
    this.run('INSERT INTO ai_usage_quotas (account_id, period_start_ms, requests_limit) VALUES (?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET requests_limit = excluded.requests_limit',
      accountId, nowMs, requestsLimit);
  }

  async listQuotas(limit: number): Promise<QuotaRecord[]> {
    return this.all<{ account_id: string; period_start_ms: number; requests_used: number; requests_limit: number }>('SELECT * FROM ai_usage_quotas ORDER BY period_start_ms DESC LIMIT ?', limit)
      .map((r) => ({ accountId: r.account_id, periodStartMs: r.period_start_ms, requestsUsed: r.requests_used, requestsLimit: r.requests_limit }));
  }

  async applyBillingEvent(event: BillingEvent, nowMs: number): Promise<'applied' | 'replayed'> {
    return this.transaction(() => {
      if (this.run('INSERT INTO billing_events (event_id, event_type, received_at_ms) VALUES (?, ?, ?) ON CONFLICT (event_id) DO NOTHING', event.id, event.type, nowMs) !== 1) return 'replayed';
      const next = licenceAfterBillingEvent(event, this.readLicence(event.data.licenceId), nowMs);
      if (next) this.writeLicence(next);
      return 'applied';
    });
  }

  async listBillingEvents(limit: number): Promise<BillingEventRecord[]> {
    return this.all<{ event_id: string; event_type: string; received_at_ms: number }>('SELECT * FROM billing_events ORDER BY received_at_ms DESC, rowid DESC LIMIT ?', limit)
      .map((r) => ({ eventId: r.event_id, eventType: r.event_type, receivedAtMs: r.received_at_ms }));
  }

  async insertModelAsset(a: ModelAssetRecord): Promise<boolean> {
    try {
      this.run('INSERT INTO model_assets (asset_id, kind, version, channel, path, sha256, bytes, required_app_min, status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        a.assetId, a.kind, a.version, a.channel, a.path, a.sha256, a.bytes, a.requiredAppMin, a.status, a.createdAtMs);
      return true;
    } catch (error) { if (isConstraint(error)) return false; throw error; }
  }
  async listLiveModelAssets(channel: string) {
    return this.all<AssetRow>('SELECT * FROM model_assets WHERE status = \'live\' AND channel = ? ORDER BY asset_id', channel).map(asset);
  }
  async promoteModelAsset(assetId: string, version: string, channel: string): Promise<boolean> {
    return this.transaction(() => {
      if (!this.get('SELECT 1 FROM model_assets WHERE asset_id = ? AND version = ? AND channel = ?', assetId, version, channel)) return false;
      this.run('UPDATE model_assets SET status = \'retired\' WHERE asset_id = ? AND channel = ? AND status = \'live\'', assetId, channel);
      this.run('UPDATE model_assets SET status = \'live\' WHERE asset_id = ? AND version = ? AND channel = ?', assetId, version, channel);
      const name = `manifest_revision_${channel}`;
      const revision = Number(this.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', name)?.value ?? 1) + 1;
      this.run('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value', name, String(revision));
      return true;
    });
  }
  async insertRelease(r: ReleaseRecord): Promise<boolean> {
    try {
      this.run('INSERT INTO desktop_releases (platform, channel, version, url, notes, min_supported, published_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        r.platform, r.channel, r.version, r.url, r.notes, r.minSupported, r.publishedAtMs);
      return true;
    } catch (error) { if (isConstraint(error)) return false; throw error; }
  }
  async listReleases(platform: string, channel: string): Promise<ReleaseRecord[]> {
    return this.all<{ version: string; url: string; notes: string; min_supported: string; published_at_ms: number }>(
      'SELECT version, url, notes, min_supported, published_at_ms FROM desktop_releases WHERE platform = ? AND channel = ?', platform, channel)
      .map((r) => ({ platform, channel, version: r.version, url: r.url, notes: r.notes, minSupported: r.min_supported, publishedAtMs: r.published_at_ms }));
  }

  async insertContactMessage(m: ContactMessageRecord): Promise<void> {
    this.run('INSERT INTO contact_messages (message_id, received_at_ms, name, email, message, status) VALUES (?, ?, ?, ?, ?, ?)', m.messageId, m.receivedAtMs, m.name, m.email, m.message, m.status);
  }
  async listContactMessages(limit: number): Promise<ContactMessageRecord[]> {
    return this.all<{ message_id: string; received_at_ms: number; name: string; email: string; message: string; status: ContactStatus }>(
      'SELECT * FROM contact_messages ORDER BY received_at_ms DESC, rowid DESC LIMIT ?', limit)
      .map((r) => ({ messageId: r.message_id, receivedAtMs: r.received_at_ms, name: r.name, email: r.email, message: r.message, status: r.status }));
  }
  async setContactMessageStatus(messageId: string, status: ContactStatus) {
    return this.run('UPDATE contact_messages SET status = ? WHERE message_id = ?', status, messageId) === 1;
  }

  async getSetting(name: string) { return this.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', name)?.value; }
  async setSetting(name: string, value: string): Promise<void> {
    this.run('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value', name, value);
  }
  async counts() {
    const n = (table: string) => this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
    return { accounts: n('accounts'), licences: n('licences'), activations: n('device_activations') };
  }
  async audit(e: AuditRecord): Promise<void> {
    this.run('INSERT INTO audit_log (audit_id, at_ms, actor, action, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)', uuid(), e.atMs, e.actor, e.action, e.outcome, clipAuditDetail(e.detail));
  }
  async listAudit(limit: number): Promise<AuditRecord[]> {
    // rowid breaks ties between entries written in the same millisecond, newest first.
    return this.all<AuditRecord & { at_ms: number }>('SELECT at_ms, actor, action, outcome, detail FROM audit_log ORDER BY at_ms DESC, rowid DESC LIMIT ?', limit)
      .map((r) => ({ atMs: r.at_ms, actor: r.actor, action: r.action, outcome: r.outcome, detail: r.detail }));
  }

  async close(): Promise<void> { this.db.close(); }
}
