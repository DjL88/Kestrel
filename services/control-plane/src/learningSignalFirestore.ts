/** Firestore sink for the learning signal: `learning_consent/{subject}` and `learning_signals/{auto id}`. */
import { uuid } from './crypto.ts';
import type { FirestoreLike } from './firestoreStore.ts';
import type { LearningRecord, LearningSink } from './learningSignal.ts';

export class FirestoreLearningSink implements LearningSink {
  constructor(private readonly db: FirestoreLike) {}
  async getConsent(subject: string) {
    const snap = await this.db.collection('learning_consent').doc(subject).get();
    return snap.exists && snap.data()!.consent === true;
  }
  async setConsent(subject: string, consent: boolean) { await this.db.collection('learning_consent').doc(subject).set({ subject, consent }); }
  async append(record: LearningRecord) { await this.db.collection('learning_signals').doc(uuid()).set({ ...record }); }
  async deleteBySubject(subject: string) {
    // The standing consent endpoint calls this on withdrawal. The legacy
    // signals, Kite44 shadows and any previously approved project/photo
    // policies must ALL be erased: otherwise re-opting in could silently
    // revive a formerly private family album. Every document is scoped by the
    // server-derived subject; other accounts' documents are never selected.
    // Read-only schema-level indexes (collection/subject) use equality queries.
    let total = 0;
    for (const collectionName of [
      'learning_signals',
      'kite44_shadow_signals',
      'kite44_project_policies',
      'kite44_photo_exclusions',
    ] as const) {
      for (;;) {
        const removed = await this.db.runTransaction(async (tx) => {
          const collection = this.db.collection(collectionName);
          const snap = await tx.get(collection.where('subject', '==', subject).limit(400));
          for (const d of snap.docs) tx.delete(collection.doc(d.id));
          return snap.size;
        });
        total += removed;
        if (removed < 400) break;
      }
    }
    return total;
  }
}
