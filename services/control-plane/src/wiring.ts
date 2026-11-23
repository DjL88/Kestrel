/**
 * Builds the optional backend services (cloud processing, safe copy, learning signal, spend guard) from the environment.
 * Everything is OFF unless its variable is set, and nothing is built without Firestore, so SQLite development and the
 * deployed service as it is today are unchanged. Nothing here touches Google Cloud until an owner-applied deployment sets
 * these variables. Pence figures are estimates (spendGuard.ts), not Google's prices.
 */
import type { AppOptions } from './app.ts';
import { GcsCloudRunner, GcsSafeCopyStorage, CloudRunJobTrigger, metadataAccessToken, openGcsBucket, type GcsBucketLike } from './gcsAdapters.ts';
import { FirestoreCloudLedger } from './cloudLedgerFirestore.ts';
import { FirestoreLearningSink } from './learningSignalFirestore.ts';
import { FirestoreSafeCopyCatalog } from './safeCopyFirestore.ts';
import { FirestoreSpendGuard } from './spendGuard.ts';
import type { FirestoreLike } from './firestoreStore.ts';

export interface WiringDeps {
  firestore?: FirestoreLike;
  env?: NodeJS.ProcessEnv;
  openBucket?: (name: string) => Promise<GcsBucketLike>;
  token?: () => Promise<string>;
}
export type OptionalServices = Pick<AppOptions, 'cloud' | 'safeCopy' | 'learning' | 'learningWithdrawal' | 'spend'> & { enabled: string[] };

function whole(env: NodeJS.ProcessEnv, name: string, dflt: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${name} must be a whole number from 0 to ${max}`);
  return n;
}

export async function buildOptionalServices(deps: WiringDeps): Promise<OptionalServices> {
  const env = deps.env ?? process.env;
  const db = deps.firestore;
  if (!db) return { enabled: [] };
  const open = deps.openBucket ?? openGcsBucket;
  const out: OptionalServices = { enabled: [] };

  out.spend = {
    guard: new FirestoreSpendGuard(db),
    ceilingPence: whole(env, 'KCP_MONTHLY_SPEND_CEILING_PENCE', 1500, 1_000_000),
    cloudJobPence: whole(env, 'KCP_CLOUD_JOB_PENCE', 2, 100_000),
    aiCallPence: whole(env, 'KCP_AI_CALL_PENCE', 1, 100_000),
  };
  out.enabled.push('spend-guard');

  if (env.KCP_CLOUD_PROCESSING_BUCKET && env.KCP_CLOUD_RUNNER_JOB) {
    const bucket = await open(env.KCP_CLOUD_PROCESSING_BUCKET);
    const trigger = new CloudRunJobTrigger(env.KCP_CLOUD_RUNNER_JOB, deps.token ?? (() => metadataAccessToken()));
    const ledger = new FirestoreCloudLedger(db);
    out.cloud = {
      runner: new GcsCloudRunner(bucket, trigger), ledger,
      settleFailed: (jobId, legacySpendPence) => ledger.settleFailed(jobId, legacySpendPence),
      jobsPerPeriod: whole(env, 'KCP_CLOUD_JOBS_PER_PERIOD', 50, 100_000),
      maxInputBytes: whole(env, 'KCP_CLOUD_MAX_INPUT_BYTES', 120_000_000, 2_000_000_000),
    };
    out.enabled.push('cloud-processing');
  }
  if (env.KCP_SAFE_COPY_BUCKET) {
    out.safeCopy = {
      storage: new GcsSafeCopyStorage(await open(env.KCP_SAFE_COPY_BUCKET)), catalog: new FirestoreSafeCopyCatalog(db),
      bytesQuota: whole(env, 'KCP_SAFE_COPY_BYTES_QUOTA', 10_000_000_000, 10_000_000_000_000),
    };
    out.enabled.push('safe-copy');
  }
  // Withdrawal/deletion must remain available with collection disabled.
  // This service cannot enable research writes: only the optional 'learning'
  // dependency is attached to the collection routes.
  out.learningWithdrawal = new FirestoreLearningSink(db);
  if (env.KCP_LEARNING_ENABLED === '1') { out.learning = out.learningWithdrawal as FirestoreLearningSink; out.enabled.push('learning-signal'); }
  return out;
}
