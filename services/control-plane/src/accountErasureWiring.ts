/**
 * Builds the account deletion service (accountErasure.ts) the same way for the control plane (server.ts) and the daily
 * Cloud Run job (runAccountDeletions.ts), so both clear exactly the same things.
 *
 * Everything it clears lives in Firestore, so each part is built from the database alone, whether or not that feature
 * is switched on now: a person who used shared projects or alerts while they were on still has records to delete.
 * Nothing is sent: alert devices are only forgotten, never messaged. Cloud photos and gallery previews need the UK
 * bucket (KCP_GALLERY_BUCKET); without it their records are left for a run that has the bucket, never half-deleted.
 */
import { accountErasure } from './accountErasure.ts';
import { FirestoreCloudBalance } from './cloudBalance.ts';
import { CloudPhotoStore } from './cloudPhotos.ts';
import { CollabStore } from './collaboration.ts';
import type { FirestoreLike, FirestoreStore } from './firestoreStore.ts';
import { GalleryStore } from './gallery.ts';
import { GcsSafeCopyStorage, openGcsBucket, type GcsBucketLike } from './gcsAdapters.ts';
import { learningSubjectFor } from './learningSignal.ts';
import { FirestoreLearningSink } from './learningSignalFirestore.ts';
import { NoticeContacts } from './noticeContacts.ts';
import { NoticeStore } from './notices.ts';
import { PushService } from './push.ts';
import { FirestoreSafeCopyCatalog } from './safeCopyFirestore.ts';

export async function buildAccountErasure(db: FirestoreLike, store: FirestoreStore, env: NodeJS.ProcessEnv = process.env, open: (name: string) => Promise<GcsBucketLike> = openGcsBucket) {
  const bucket = env.KCP_GALLERY_BUCKET ? new GcsSafeCopyStorage(await open(env.KCP_GALLERY_BUCKET)) : undefined;
  const learning = new FirestoreLearningSink(db);
  return accountErasure({
    db, store,
    collab: new CollabStore(db),
    cloudPhotos: bucket ? new CloudPhotoStore(db, bucket) : undefined,
    gallery: bucket ? new GalleryStore(db, bucket) : undefined,
    push: new PushService(db, { send: async () => 'error' as const }),
    contacts: new NoticeContacts(db, undefined),
    notices: new NoticeStore(db),
    balance: new FirestoreCloudBalance(db),
    safeCopy: new FirestoreSafeCopyCatalog(db),
    learning: { forget: (accountId) => learning.deleteBySubject(learningSubjectFor(accountId)) },
    now: () => Date.now(),
  });
}
