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
    let total = 0;
    for (;;) {
      const removed = await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(this.db.collection('learning_signals').where('subject', '==', subject).limit(400));
        for (const d of snap.docs) tx.delete(this.db.collection('learning_signals').doc(d.id));
        return snap.size;
      });
      total += removed;
      if (removed < 400) return total;
    }
  }
}
