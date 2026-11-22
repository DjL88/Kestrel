/**
 * Firestore catalog for safe copy: `safecopy_settings/{account}`, `safecopy_usage/{account}` (a running byte total, so
 * a quota check is one read, not a scan) and `safecopy_items/{account}|{level}|{sha256}` (bytes, committed). Only ids,
 * levels, hashes and sizes: never a file name or photo content. Reserve and remove are transactions.
 */
import type { FirestoreLike } from './firestoreStore.ts';
import type { SafeCopyCatalog, SafeCopyLevel, SafeCopySettings } from './safeCopy.ts';

const OFF: SafeCopySettings = { recipes: false, previews: false, originals: false };
const itemId = (a: string, l: string, s: string) => `${a}|${l}|${s}`;

export class FirestoreSafeCopyCatalog implements SafeCopyCatalog {
  constructor(private readonly db: FirestoreLike) {}
  private ref(c: string, id: string) { return this.db.collection(c).doc(id); }

  async getSettings(accountId: string): Promise<SafeCopySettings> {
    const snap = await this.ref('safecopy_settings', accountId).get();
    const d = snap.exists ? snap.data()! : {};
    return { recipes: d.recipes === true, previews: d.previews === true, originals: d.originals === true };
  }
  async setSettings(accountId: string, levels: Partial<SafeCopySettings>): Promise<SafeCopySettings> {
    const next = { ...(await this.getSettings(accountId) ?? OFF), ...levels };
    await this.ref('safecopy_settings', accountId).set({ ...next });
    return next;
  }
  async usage(accountId: string): Promise<number> {
    const snap = await this.ref('safecopy_usage', accountId).get();
    return snap.exists ? Number(snap.data()!.bytes ?? 0) : 0;
  }
  async reserve(accountId: string, level: SafeCopyLevel, sha256: string, bytes: number, quota: number) {
    return this.db.runTransaction(async (tx) => {
      const itemRef = this.ref('safecopy_items', itemId(accountId, level, sha256));
      const usageRef = this.ref('safecopy_usage', accountId);
      const item = await tx.get(itemRef);
      const usage = await tx.get(usageRef);
      if (item.exists && item.data()!.committed === true) return 'stored' as const;
      if (item.exists) return 'reserved' as const; // already reserved and counted: an upload retry costs nothing more
      const used = usage.exists ? Number(usage.data()!.bytes ?? 0) : 0;
      if (used + bytes > quota) return 'quota' as const;
      tx.set(itemRef, { accountId, level, sha256, bytes, committed: false });
      tx.set(usageRef, { accountId, bytes: used + bytes });
      return 'reserved' as const;
    });
  }
  async commit(accountId: string, level: SafeCopyLevel, sha256: string) {
    return this.db.runTransaction(async (tx) => {
      const ref = this.ref('safecopy_items', itemId(accountId, level, sha256));
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      tx.update(ref, { committed: true });
      return true;
    });
  }
  async get(accountId: string, level: SafeCopyLevel, sha256: string) {
    const snap = await this.ref('safecopy_items', itemId(accountId, level, sha256)).get();
    return snap.exists ? { bytes: Number(snap.data()!.bytes), committed: snap.data()!.committed === true } : undefined;
  }
  async remove(accountId: string, level: SafeCopyLevel, sha256: string) {
    await this.db.runTransaction(async (tx) => {
      const itemRef = this.ref('safecopy_items', itemId(accountId, level, sha256));
      const usageRef = this.ref('safecopy_usage', accountId);
      const item = await tx.get(itemRef);
      const usage = await tx.get(usageRef);
      if (!item.exists) return;
      tx.delete(itemRef);
      tx.set(usageRef, { accountId, bytes: Math.max((usage.exists ? Number(usage.data()!.bytes ?? 0) : 0) - Number(item.data()!.bytes), 0) });
    });
  }
}
