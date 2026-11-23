/**
 * Kite44 shadow-only research ledger. No public API is connected to this module.
 *
 * A caller must authenticate the account first and supply the server-derived
 * learning pseudonym (never a client-supplied subject). Consent is checked live
 * in the same Firestore transaction as every shadow write. The project must be
 * separately approved; an excluded photo is always denied. This cannot grant
 * any permission to upload or read image bytes.
 */
import { createHmac } from 'node:crypto';
import { uuid } from './crypto.ts';
import type { FirestoreLike } from './firestoreStore.ts';

export interface Kite44ShadowPayload {
  schemaVersion: 1;
  kind: 'subject' | 'quality' | 'mask' | 'cull' | 'edit' | 'denoise' | 'colour';
  modelFamily: 'Kite44' | 'external';
  modelVersion: string;
  outcome: 'proposed' | 'accepted' | 'modified' | 'undone' | 'rejected' | 'unknown';
  metrics: Record<string, number>;
  adjustments: Record<string, number>;
}

const kinds = new Set(['subject','quality','mask','cull','edit','denoise','colour']);
const outcomes = new Set(['proposed','accepted','modified','undone','rejected','unknown']);
const metrics = new Set(['eyeSharpness','subjectConfidence','exposureBalance','highlightClipping','shadowClipping','noiseEstimate','haloEstimate','maskCoverage','editQuality']);
const sliders = new Set(['exposure','warmth','contrast','highlights','shadows','vibrance','sharpen','denoise']);

function safePayload(payload: Kite44ShadowPayload): boolean {
  if (payload.schemaVersion !== 1 || !kinds.has(payload.kind)
    || !outcomes.has(payload.outcome) || !['Kite44', 'external'].includes(payload.modelFamily)
    || !/^[a-zA-Z0-9._-]{1,40}$/.test(payload.modelVersion)) return false;
  const validNumbers = (values: Record<string, number>, allowed: Set<string>) =>
    values && typeof values === 'object' && !Array.isArray(values)
    && Object.entries(values).length <= allowed.size
    && Object.entries(values).every(([k,v]) => allowed.has(k) && typeof v === 'number' && Number.isFinite(v) && v >= -2 && v <= 2);
  return validNumbers(payload.metrics, metrics) && validNumbers(payload.adjustments, sliders)
    && Object.keys(payload).every(k => ['schemaVersion','kind','modelFamily','modelVersion','outcome','metrics','adjustments'].includes(k));
}

export class Kite44ResearchLedger {
  constructor(private readonly db: FirestoreLike, private readonly secret: string) {
    if (secret.length < 32) throw new Error('Kite44 research ledger requires a 32-character server secret');
  }
  private key(subject: string, projectId: string, photoId?: string) {
    if (!subject || !projectId || (photoId !== undefined && !photoId)) throw new Error('Missing authenticated project/photo scope');
    return createHmac('sha256', this.secret)
      .update(JSON.stringify([subject, projectId, photoId ?? null])).digest('hex');
  }
  /**
   * An authenticated owner can approve a project for SHADOW contributions only.
   * Never use this to approve customer photo or crop uploads.
   */
  /**
   * Delete in bounded batches AFTER revoking a policy. Later arrivals cannot
   * pass the live transactional permission check. Do not store raw project IDs.
   */
  private async purge(field: 'subject' | 'projectKey' | 'photoKey', value: string): Promise<number> {
    let total = 0;
    for (;;) {
      const count = await this.db.runTransaction(async tx => {
        const collection = this.db.collection('kite44_shadow_signals');
        const matches = await tx.get(collection.where(field, '==', value).limit(200));
        for (const doc of matches.docs) tx.delete(collection.doc(doc.id));
        return matches.size;
      });
      total += count;
      if (count < 200) return total;
    }
  }

  async setProjectSharing(subject: string, projectId: string, allowed: boolean): Promise<number> {
    const projectKey = this.key(subject, projectId);
    await this.db.collection('kite44_project_policies').doc(projectKey)
      .set({ subject, allowShadow: allowed === true });
    return allowed ? 0 : this.purge('projectKey', projectKey);
  }

  async excludePhoto(subject: string, projectId: string, photoId: string, excluded: boolean): Promise<number> {
    const photoKey = this.key(subject, projectId, photoId);
    await this.db.collection('kite44_photo_exclusions').doc(photoKey)
      .set({ subject, excluded: excluded === true });
    return excluded ? this.purge('photoKey', photoKey) : 0;
  }

  /**
   * This must be called by the future authenticated withdrawal route, rather
   * than merely setting the legacy account flag to false. The legacy learning
   * sink also needs its own existing deleteBySubject call.
   */
  async revokeAndDelete(subject: string): Promise<number> {
    await this.db.collection('learning_consent').doc(subject).set({ consent: false });
    return this.purge('subject', subject);
  }
  /**
   * Return false without writing whenever any consent is absent or revoked.
   * The account consent, project policy and photo exclusion are all read inside
   * the same transaction which commits the record. There is no image access.
   */
  async appendShadow(subject: string, projectId: string, photoId: string, record: Kite44ShadowPayload): Promise<boolean> {
    if (!safePayload(record)) return false;
    const account = this.db.collection('learning_consent').doc(subject);
    const project = this.db.collection('kite44_project_policies').doc(this.key(subject, projectId));
    const photo = this.db.collection('kite44_photo_exclusions').doc(this.key(subject, projectId, photoId));
    const projectKey = this.key(subject, projectId);
    const photoKey = this.key(subject, projectId, photoId);
    const out = this.db.collection('kite44_shadow_signals').doc(uuid());
    return this.db.runTransaction(async tx => {
      const [a,p,f] = await Promise.all([tx.get(account), tx.get(project), tx.get(photo)]);
      if (a.data()?.consent !== true || p.data()?.allowShadow !== true || f.data()?.excluded === true) return false;
      tx.create(out, { ...record, subject, projectKey, photoKey });
      return true;
    });
  }
}
