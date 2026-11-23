/**
 * Firestore ledger for the Cloud Processing gate: `cloud_jobs/{jobId}` and `cloud_usage/{accountId}`.
 * A job document holds ids, kind, byte count, status and the time of the person's consent. Never photo bytes, file
 * names, EXIF or upload URLs. Quota reservation and conditional job status updates use Firestore transactions.
 */
import type { CloudJobRecord, CloudLedger, CloudStatus } from './cloudJobs.ts';
import type { FirestoreLike } from './firestoreStore.ts';
import { firestoreSpendRef } from './spendGuard.ts';

const JOBS = 'cloud_jobs';
const USAGE = 'cloud_usage';

export class FirestoreCloudLedger implements CloudLedger {
  constructor(private readonly db: FirestoreLike) {}

  async reserve(accountId: string, nowMs: number, limit: number, periodMs: number): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.collection(USAGE).doc(accountId);
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data()! : undefined;
      let start = typeof d?.periodStartMs === 'number' ? d.periodStartMs : nowMs;
      let used = typeof d?.used === 'number' ? d.used : 0;
      if (nowMs - start >= periodMs) { start = nowMs; used = 0; }
      const granted = used < limit;
      tx.set(ref, { accountId, periodStartMs: start, used: granted ? used + 1 : used });
      return granted;
    });
  }

  async refund(accountId: string, reservedAtMs: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.collection(USAGE).doc(accountId);
      const usage = (await tx.get(ref)).data();
      if (typeof usage?.periodStartMs === 'number' && reservedAtMs >= usage.periodStartMs) {
        tx.update(ref, { used: Math.max(Number(usage.used ?? 0) - 1, 0) });
      }
    });
  }

  async put(record: CloudJobRecord): Promise<void> {
    const { jobId, accountId, kind, inputBytes, status, createdAtMs, consentAtMs, spendPence } = record;
    await this.db.collection(JOBS).doc(jobId).set({
      jobId, accountId, kind, inputBytes, status, createdAtMs, consentAtMs,
      ...(spendPence === undefined ? {} : { spendPence }),
    });
  }

  async get(jobId: string): Promise<CloudJobRecord | undefined> {
    const snap = await this.db.collection(JOBS).doc(jobId).get();
    if (!snap.exists) return undefined;
    const d = snap.data()!;
    return {
      jobId: String(d.jobId), accountId: String(d.accountId), kind: d.kind as CloudJobRecord['kind'],
      inputBytes: Number(d.inputBytes), status: d.status as CloudJobRecord['status'],
      createdAtMs: Number(d.createdAtMs), consentAtMs: Number(d.consentAtMs),
      ...(typeof d.spendPence === 'number' ? { spendPence: d.spendPence } : {}),
    };
  }

  async transition(jobId: string, from: CloudStatus, to: CloudStatus): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.collection(JOBS).doc(jobId);
      if ((await tx.get(ref)).data()?.status !== from) return false;
      tx.update(ref, { status: to });
      return true;
    });
  }

  /** An interrupted commit leaves the job running, so the next poll can retry the full settlement. */
  async settleFailed(jobId: string, legacySpendPence: number): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const jobRef = this.db.collection(JOBS).doc(jobId);
      const job = (await tx.get(jobRef)).data();
      if (job?.status !== 'running') return false;

      const reservedAtMs = Number(job.createdAtMs);
      const reservedPence = typeof job.spendPence === 'number' ? job.spendPence : legacySpendPence;
      const usageRef = this.db.collection(USAGE).doc(String(job.accountId));
      const usage = (await tx.get(usageRef)).data();
      const spendRef = firestoreSpendRef(this.db, reservedAtMs);
      const spend = reservedPence > 0 ? (await tx.get(spendRef)).data() : undefined;

      tx.update(jobRef, { status: 'failed' });
      if (typeof usage?.periodStartMs === 'number' && reservedAtMs >= usage.periodStartMs) {
        tx.update(usageRef, { used: Math.max(Number(usage.used ?? 0) - 1, 0) });
      }
      if (spend) tx.update(spendRef, { pence: Math.max(Number(spend.pence ?? 0) - reservedPence, 0) });
      return true;
    });
  }
}
