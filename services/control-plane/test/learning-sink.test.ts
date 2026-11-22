import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryLearningSink, type LearningSink } from '../src/learningSignal.ts';
import { FirestoreLearningSink } from '../src/learningSignalFirestore.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

const rec = (subject: string) => ({ subject, receivedDay: '2026-11-22', source: 'gemini' as const, capability: 'exposure' as const, action: 'accepted' as const, proposal: { exposure: 0.1 }, final: { exposure: 0.1 }, appVersion: '26.11.2' });
for (const [name, make] of [['memory', () => new MemoryLearningSink()], ['firestore', () => new FirestoreLearningSink(new MemoryFirestore())]] as Array<[string, () => LearningSink]>) {
  test(`${name}: consent flag, append, delete-by-subject`, async () => {
    const s = make();
    assert.equal(await s.getConsent('a'), false);
    await s.setConsent('a', true); assert.equal(await s.getConsent('a'), true);
    await s.append(rec('a')); await s.append(rec('a')); await s.append(rec('b'));
    assert.equal(await s.deleteBySubject('a'), 2);
    assert.equal(await s.deleteBySubject('a'), 0);
    assert.equal(await s.deleteBySubject('b'), 1);
    await s.setConsent('a', false); assert.equal(await s.getConsent('a'), false);
  });
}
