import { CURSOR_MIN_INTERVAL_MS, livePeers, shouldSendCursor, type ParticipantKind, type Peer, type PhotoPoint } from '../core/editingSequence';
import type { CollabClient } from './collabClient';

/**
 * Live cursors for a shared project (#1387 C04), through Firebase Realtime Database. The control plane hands out a
 * one-hour token for this project only; it is used in a separate Firebase app instance, so the person's own sign-in
 * is untouched. Our entry is overwritten as the pointer moves and removed by the server when the connection drops.
 * Nothing is stored or replayed. Firebase is loaded only when a shared project is open.
 */
export interface PresenceSession {
  /** The photo on screen and where the pointer is on it (null when off the photo). Throttled to about 15 a second. */
  update(photoId: string | null, point: PhotoPoint | null): void;
  close(): void;
}

const env = import.meta.env;
const firebaseConfig = { apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID };

export async function connectPresence(
  client: CollabClient, projectId: string, self: { name: string; kind: ParticipantKind }, onPeers: (peers: Peer[]) => void,
): Promise<PresenceSession> {
  const grant = await client.presenceToken(projectId);
  const [{ initializeApp, deleteApp, getApps }, { getAuth, signInWithCustomToken, inMemoryPersistence, setPersistence }, db] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('firebase/database'),
  ]);
  const name = `inflight-presence-${projectId}`;
  const app = getApps().find((existing) => existing.name === name) ?? initializeApp({ ...firebaseConfig, databaseURL: grant.databaseUrl }, name);
  const auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence); // never written to disk
  await signInWithCustomToken(auth, grant.customToken);
  const database = db.getDatabase(app, grant.databaseUrl);
  const mine = db.ref(database, `presence/${projectId}/${grant.uid}`);
  const all = db.ref(database, `presence/${projectId}`);
  await db.onDisconnect(mine).remove();

  let latest: Record<string, unknown> | null = null;
  const publish = () => onPeers(livePeers(latest, grant.uid, Date.now()));
  const stopListening = db.onValue(all, (snapshot) => { latest = snapshot.val() as Record<string, unknown> | null; publish(); });
  const sweep = setInterval(publish, 30_000); // drop peers who went stale without a clean disconnect

  let lastSent: number | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let next: { photoId: string | null; point: PhotoPoint | null } = { photoId: null, point: null };
  const send = () => {
    pending = null; lastSent = Date.now();
    const entry: Record<string, unknown> = { name: self.name.slice(0, 80), kind: self.kind, at: db.serverTimestamp() };
    if (next.photoId) entry.photoId = next.photoId;
    if (next.photoId && next.point) { entry.x = next.point.x; entry.y = next.point.y; }
    void db.set(mine, entry).catch(() => undefined);
  };
  const heartbeat = setInterval(send, 45_000); // keeps our entry fresh while the pointer is still
  send();

  return {
    update(photoId, point) {
      next = { photoId, point };
      if (shouldSendCursor(lastSent, Date.now())) send();
      else if (!pending) pending = setTimeout(send, CURSOR_MIN_INTERVAL_MS);
    },
    close() {
      clearInterval(sweep); clearInterval(heartbeat);
      if (pending) clearTimeout(pending);
      stopListening();
      void db.remove(mine).catch(() => undefined).finally(() => { void deleteApp(app).catch(() => undefined); });
    },
  };
}
