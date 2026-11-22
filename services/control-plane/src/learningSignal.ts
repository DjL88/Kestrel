/**
 * Opt-in learning signal (backend item 4): how people corrected a suggestion, kept as calibration data for the
 * decision maker. Off by default, a separate consent from managed AI, revocable, and withdrawing deletes what was stored.
 * A signal is numbers and fixed words only: no photo, no file name, no free text, no account id (a pseudonym is stored so
 * deletion works), no timestamp finer than a day. In-memory sink here; Firestore sink beside it, not wired until approved.
 */
export const LEARNING_SOURCES = ['gemini', 'byo', 'on-device'] as const;
export const LEARNING_CAPABILITIES = ['colour', 'exposure', 'subject', 'species', 'crop'] as const;
export const LEARNING_ACTIONS = ['accepted', 'edited', 'rejected'] as const;

export interface LearningRecord {
  subject: string; receivedDay: string;
  source: typeof LEARNING_SOURCES[number]; capability: typeof LEARNING_CAPABILITIES[number]; action: typeof LEARNING_ACTIONS[number];
  candidateRank?: number; proposal: Record<string, number>; final: Record<string, number>; appVersion: string;
}

export interface LearningSink {
  getConsent(subject: string): Promise<boolean>;
  setConsent(subject: string, consent: boolean): Promise<void>;
  append(record: LearningRecord): Promise<void>;
  /** Returns how many records were removed. */
  deleteBySubject(subject: string): Promise<number>;
}

export class MemoryLearningSink implements LearningSink {
  private consent = new Map<string, boolean>();
  private records: LearningRecord[] = [];
  async getConsent(s: string) { return this.consent.get(s) === true; }
  async setConsent(s: string, c: boolean) { this.consent.set(s, c); }
  async append(r: LearningRecord) { this.records.push(structuredClone(r)); }
  async deleteBySubject(s: string) { const n = this.records.length; this.records = this.records.filter((r) => r.subject !== s); return n - this.records.length; }
  count() { return this.records.length; }
  all() { return this.records.map((r) => structuredClone(r)); }
}
