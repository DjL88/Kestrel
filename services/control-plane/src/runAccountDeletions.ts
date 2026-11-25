/**
 * The daily account deletion run, as the Cloud Run job `kestrel-account-deletions` (infra/gcp/account-deletions.tf).
 * Cloud Scheduler starts it once a day; it deletes every account whose 30 days have passed (accountErasure.ts), and
 * finishes any that stopped part-way. Safe to run again at any time. Off unless Terraform's account_deletion_enabled.
 *
 * Environment (set by Terraform; nothing here is secret):
 *   KCP_FIRESTORE_PROJECT, KCP_FIRESTORE_DATABASE  the control plane's Firestore
 *   KCP_GALLERY_BUCKET                             the UK bucket holding cloud photos and gallery previews (optional)
 */
import { buildAccountErasure } from './accountErasureWiring.ts';
import { FirestoreStore, type FirestoreLike } from './firestoreStore.ts';
import { openFirestore } from './openStore.ts';

export async function runAccountDeletions(env: NodeJS.ProcessEnv = process.env) {
  const db = await openFirestore({ firestoreProjectId: env.KCP_FIRESTORE_PROJECT, firestoreDatabaseId: env.KCP_FIRESTORE_DATABASE });
  try {
    const fs = db as unknown as FirestoreLike;
    const erasure = await buildAccountErasure(fs, new FirestoreStore(fs), env);
    const result = await erasure.runDue();
    console.log(`account-deletions: ${JSON.stringify(result)}`);
    if (result.failed > 0) process.exitCode = 1; // a failed account stays 'deleting' and is retried on the next run
    return result;
  } finally {
    await db.terminate();
  }
}

if (process.argv[1]?.endsWith('runAccountDeletions.ts')) await runAccountDeletions();
