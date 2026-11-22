/**
 * Managed "safe copy" (backend item 5): an opt-in backup to InFlight's own UK storage. Never the default. Each level
 * (recipes, previews, originals) is its own switch; originals leave the device only if that switch is on. Objects are
 * content-addressed per account (no file names, no account id in the key), uploads and downloads use short-lived signed
 * URLs, usage is capped in bytes, and a lapse or the kill switch stops uploads only: a person can always read and delete
 * their own copy. In-memory fakes only; the real bucket is not created and nothing here is wired to production.
 */
import { sha256Hex } from './crypto.ts';

export const SAFE_COPY_LEVELS = ['recipes', 'previews', 'originals'] as const;
export type SafeCopyLevel = typeof SAFE_COPY_LEVELS[number];
export type SafeCopySettings = Record<SafeCopyLevel, boolean>;
/** Largest single object per level. Originals above this need chunked upload, which is not built. */
export const SAFE_COPY_MAX_BYTES: Record<SafeCopyLevel, number> = { recipes: 1_000_000, previews: 8_000_000, originals: 500_000_000 };

export interface SafeCopyStorage {
  signUpload(key: string, bytes: number, sha256: string): Promise<string>;
  signDownload(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}
export interface SafeCopyCatalog {
  getSettings(accountId: string): Promise<SafeCopySettings>;
  setSettings(accountId: string, levels: Partial<SafeCopySettings>): Promise<SafeCopySettings>;
  /** Atomically reserves bytes. 'stored' means this exact object is already committed (free). */
  reserve(accountId: string, level: SafeCopyLevel, sha256: string, bytes: number, quota: number): Promise<'reserved' | 'stored' | 'quota'>;
  commit(accountId: string, level: SafeCopyLevel, sha256: string): Promise<boolean>;
  get(accountId: string, level: SafeCopyLevel, sha256: string): Promise<{ bytes: number; committed: boolean } | undefined>;
  remove(accountId: string, level: SafeCopyLevel, sha256: string): Promise<void>;
  usage(accountId: string): Promise<number>;
}
export interface SafeCopyOptions { storage: SafeCopyStorage; catalog: SafeCopyCatalog; bytesQuota: number }

/** Per-account prefix is a hash, so the key carries neither the account id nor a file name. */
export const safeCopyKey = (accountId: string, level: SafeCopyLevel, sha256: string) => `accounts/${sha256Hex(`safecopy:${accountId}`).slice(0, 32)}/${level}/${sha256}`;

export class MemorySafeCopyStorage implements SafeCopyStorage {
  signedUploads = 0; lastKey: string | undefined;
  private objects = new Set<string>();
  async signUpload(key: string) { this.signedUploads++; this.lastKey = key; this.objects.add(key); return `memory://upload/${key}`; }
  async signDownload(key: string) { this.lastKey = key; return `memory://download/${key}`; }
  async delete(key: string) { this.objects.delete(key); }
  has(key: string) { return this.objects.has(key); }
}

export class MemorySafeCopyCatalog implements SafeCopyCatalog {
  private settings = new Map<string, SafeCopySettings>();
  private items = new Map<string, { bytes: number; committed: boolean }>();
  private k = (a: string, l: string, s: string) => `${a}|${l}|${s}`;
  async getSettings(a: string) { return { ...(this.settings.get(a) ?? { recipes: false, previews: false, originals: false }) }; }
  async setSettings(a: string, levels: Partial<SafeCopySettings>) { const n = { ...(await this.getSettings(a)), ...levels }; this.settings.set(a, n); return { ...n }; }
  async usage(a: string) { let t = 0; for (const [k, v] of this.items) if (k.startsWith(`${a}|`)) t += v.bytes; return t; }
  async reserve(a: string, l: SafeCopyLevel, s: string, bytes: number, quota: number) {
    const cur = this.items.get(this.k(a, l, s));
    if (cur?.committed) return 'stored' as const;
    if (!cur && (await this.usage(a)) + bytes > quota) return 'quota' as const;
    this.items.set(this.k(a, l, s), { bytes, committed: false });
    return 'reserved' as const;
  }
  async commit(a: string, l: SafeCopyLevel, s: string) { const c = this.items.get(this.k(a, l, s)); if (!c) return false; c.committed = true; return true; }
  async get(a: string, l: SafeCopyLevel, s: string) { const c = this.items.get(this.k(a, l, s)); return c ? { ...c } : undefined; }
  async remove(a: string, l: SafeCopyLevel, s: string) { this.items.delete(this.k(a, l, s)); }
}
