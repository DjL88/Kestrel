/**
 * The hourly Vertex learning tick (entry point: vertexLearningJob.ts), run as the Cloud Run job `kestrel-vertex-learning` (infra/gcp/vertex-learning.tf).
 * Cloud Scheduler starts it every hour; "Learn now" in /admin starts it at once. See vertexLearning.ts for the rules.
 *
 * Environment (all set by Terraform; nothing here is secret):
 *   KCP_FIRESTORE_PROJECT, KCP_FIRESTORE_DATABASE  the control plane's Firestore
 *   KCP_VERTEX_PROJECT                             project for Vertex AI (kestrel-hosting)
 *   KCP_VERTEX_TRAINER_IMAGE                       training container; unset = never starts a run (nothing billed)
 *   KCP_VERTEX_TRAINER_SERVICE_ACCOUNT             identity the training job runs as
 *   KCP_VERTEX_PHOTO_THRESHOLD, KCP_VERTEX_CEILING_PENCE, KCP_VERTEX_PENCE_PER_HOUR, KCP_VERTEX_MAX_RUN_HOURS,
 *   KCP_VERTEX_REGION, KCP_VERTEX_MACHINE_TYPE       see DEFAULT_CONFIG
 */
import { openFirestore } from './openStore.ts';
import { metadataAccessToken } from './gcsAdapters.ts';
import { VertexLearningLedger, VertexRest, configFromEnv, tick } from './vertexLearning.ts';

export async function runVertexLearningTick(env: NodeJS.ProcessEnv = process.env) {
  const config = configFromEnv(env);
  const db = await openFirestore({ firestoreProjectId: env.KCP_FIRESTORE_PROJECT, firestoreDatabaseId: env.KCP_FIRESTORE_DATABASE });
  try {
    if (env.KCP_VERTEX_TRAINER_IMAGE && !env.KCP_VERTEX_TRAINER_SERVICE_ACCOUNT) throw new Error('KCP_VERTEX_TRAINER_SERVICE_ACCOUNT is required with a trainer image');
    const vertex = env.KCP_VERTEX_TRAINER_IMAGE
      ? new VertexRest({
        project: env.KCP_VERTEX_PROJECT ?? '', config, trainerImage: env.KCP_VERTEX_TRAINER_IMAGE,
        serviceAccount: env.KCP_VERTEX_TRAINER_SERVICE_ACCOUNT as string, token: () => metadataAccessToken(),
      })
      : undefined;
    const result = await tick({
      ledger: new VertexLearningLedger(db), config, vertex, now: () => Date.now(), log: (l) => console.log(`vertex-learning: ${l}`),
      switchedOn: async () => (await db.collection('settings').doc('switch_vertex-learning').get()).data()?.value === '1',
    });
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await db.terminate();
  }
}
