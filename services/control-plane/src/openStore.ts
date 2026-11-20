import type { Config } from './config.ts';
import { FirestoreStore, type FirestoreLike } from './firestoreStore.ts';
import { SqliteStore } from './sqliteStore.ts';
import type { Store } from './store.ts';

/**
 * The store the configuration asks for. KCP_STORE=firestore on Cloud Run (credentials come from the service's own
 * account; FIRESTORE_EMULATOR_HOST points the client at an emulator instead). Anything else is SQLite.
 *
 * The Google client is loaded only here, and only for Firestore, so local runs and tests never need it installed.
 */
export async function openStore(config: Pick<Config, 'store' | 'databasePath' | 'firestoreProjectId' | 'firestoreDatabaseId'>): Promise<Store> {
  if (config.store === 'sqlite') return new SqliteStore(config.databasePath);
  const moduleName = '@google-cloud/firestore';
  const { Firestore } = (await import(moduleName)) as { Firestore: new (settings: Record<string, unknown>) => unknown };
  const db = new Firestore({
    ...(config.firestoreProjectId ? { projectId: config.firestoreProjectId } : {}),
    ...(config.firestoreDatabaseId ? { databaseId: config.firestoreDatabaseId } : {}),
  });
  return new FirestoreStore(db as FirestoreLike);
}
