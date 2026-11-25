import { openFirestore } from '../openStore.ts';
import { rotatePaddleKeyIfDue, secretManagerSecret, type RotationState } from './paddleKeyRotation.ts';

// Weekly Cloud Run job (infra/gcp/paddle-key-rotation.tf). Exits non-zero on failure so the alert fires; the old key
// keeps working and next week's run tries again.
const project = process.env.KCP_PADDLE_KEY_PROJECT?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim() || '';
const secretName = process.env.KCP_PADDLE_KEY_SECRET?.trim() || 'kestrel-paddle-api-key';
const db = await openFirestore({ firestoreProjectId: process.env.KCP_FIRESTORE_PROJECT, firestoreDatabaseId: process.env.KCP_FIRESTORE_DATABASE });
const doc = db.collection('paddle_key_rotation').doc('current');
try {
  const result = await rotatePaddleKeyIfDue({
    secret: secretManagerSecret({ project, secret: secretName }),
    store: { get: async () => ((await doc.get()).data() as RotationState | undefined) ?? null, set: async (state) => { await doc.set(state); } },
  });
  await db.collection('paddle_key_rotation').doc('last_run').set({ at: new Date().toISOString(), ok: true, ...result });
  console.log(JSON.stringify({ message: 'PADDLE_KEY_ROTATION_OK', ...result }));
} catch (error) {
  const reason = error instanceof Error ? error.message : 'unknown error';
  await db.collection('paddle_key_rotation').doc('last_run').set({ at: new Date().toISOString(), ok: false, reason }).catch(() => {});
  console.error(JSON.stringify({ severity: 'ERROR', message: 'PADDLE_KEY_ROTATION_FAILED', reason }));
  process.exitCode = 1;
} finally {
  await db.terminate();
}
