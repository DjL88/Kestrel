import assert from 'node:assert/strict';
import test from 'node:test';
import { chainLabelKey, quietCloudOpinion, settleStep, settleTrail, shouldAskCloud, type ChainPolicy } from './verificationTrail.ts';

const on: ChainPolicy = { flag: true, cloudPermitted: true, previewOnly: true };
const pick = (a: any, b: any) => Object.fromEntries(Object.keys(b).map((k) => [k, a[k]]));
const offline: ChainPolicy = { ...on, cloudPermitted: false };

test('verification chain: does nothing when the flag is off', () => {
    assert.equal(settleStep({ step: 'edit', impact: 'high', device: 'agree', cloud: 'agree' }, { ...on, flag: false }).outcome, 'unchecked');
  });
test('verification chain: confirms on the device when it agrees and the cloud is not asked', () => {
    const r = settleStep({ step: 'colour', impact: 'normal', device: 'agree' }, on);
    assert.deepEqual(pick(r, { outcome: 'confirmed', where: 'device' }), { outcome: 'confirmed', where: 'device' });
    assert.equal(chainLabelKey(r), 'checkedDevice');
  });
test('verification chain: keeps disputes and uncertainty for review, never rejects, and the cloud cannot overrule a dispute', () => {
    const d = settleStep({ step: 'subject', impact: 'high', device: 'disagree', cloud: 'agree' }, on);
    assert.deepEqual(pick(d, { outcome: 'review', disputed: true, where: 'device' }), { outcome: 'review', disputed: true, where: 'device' });
    assert.equal(settleStep({ step: 'edit', impact: 'normal', device: 'unsure' }, on).outcome, 'review');
  });
test('verification chain: treats a missing device check as unchecked, not as agreement', () => {
    assert.equal(settleStep({ step: 'edit', impact: 'normal' }, on).outcome, 'unchecked');
    assert.equal(settleStep({ step: 'edit', impact: 'normal', device: 'unavailable' }, on).outcome, 'unchecked');
  });
test('verification chain: asks the cloud only for disputed or high-impact steps, with permission, on previews', () => {
    assert.equal(shouldAskCloud({ impact: 'normal', device: 'agree' }, on), false);
    assert.equal(shouldAskCloud({ impact: 'high', device: 'agree' }, on), true);
    assert.equal(shouldAskCloud({ impact: 'normal', device: 'disagree' }, on), true);
    assert.equal(shouldAskCloud({ impact: 'high', device: 'agree' }, offline), false);
    assert.equal(shouldAskCloud({ impact: 'high', device: 'agree' }, { ...on, previewOnly: false }), false);
    assert.equal(shouldAskCloud({ impact: 'high', device: 'agree' }, { ...on, flag: false }), false);
  });
test('verification chain: ignores a cloud answer that was not allowed, and a cloud failure changes nothing', () => {
    assert.equal(settleStep({ step: 'edit', impact: 'high', device: 'agree', cloud: 'disagree' }, offline).outcome, 'confirmed');
    assert.deepEqual(pick(settleStep({ step: 'edit', impact: 'high', device: 'agree' }, on), { outcome: 'confirmed', where: 'device' }), { outcome: 'confirmed', where: 'device' });
    assert.equal(settleStep({ step: 'edit', impact: 'high', device: 'agree', cloud: 'unavailable' }, on).where, 'device');
  });
test('verification chain: lets the cloud make a confirmation more cautious or add its name', () => {
    assert.equal(settleStep({ step: 'edit', impact: 'high', device: 'agree', cloud: 'disagree' }, on).outcome, 'review');
    const c = settleStep({ step: 'edit', impact: 'high', device: 'agree', cloud: 'agree' }, on);
    assert.equal(chainLabelKey(c), 'checkedCloud');
  });
test('verification chain: settles a trail in step order', () => {
    const t = settleTrail([
      { step: 'subject', impact: 'normal', device: 'agree' },
      { step: 'edit', impact: 'normal', device: 'agree' },
      { step: 'colour', impact: 'normal', device: 'unsure' },
    ], on);
    assert.deepEqual(t.results.map((r) => r.step), ['edit', 'colour', 'subject']);
    assert.deepEqual(pick(t, { allConfirmed: false, needsReview: true }), { allConfirmed: false, needsReview: true });
    assert.equal(settleTrail([], on).allConfirmed, false);
  });
test('verification chain: makes the cloud opinion silent on failure and timeout', async () => {
    assert.equal(await quietCloudOpinion(async () => { throw new Error('boom'); }), undefined);
    assert.equal(await quietCloudOpinion(() => new Promise(() => {}), 10), undefined);
    assert.equal(await quietCloudOpinion(async () => 'agree'), 'agree');
    assert.equal(await quietCloudOpinion(async () => 'unavailable'), undefined);
  });
test('verification chain: shown text names only where, never a model, in every language', async () => {
  const { verificationArea } = await import('../i18n/areas/verification/index.ts');
  const src = verificationArea.source as Record<string, string>;
  for (const k of ['checkedDevice', 'checkedCloud', 'review', 'unchecked']) assert.ok(src[k]);
  const all = JSON.stringify([src, ...Object.values(verificationArea.translations)]);
  assert.ok(!/gemini|ollama|llama|claude|gpt|model/i.test(all));
  assert.equal(Object.keys(verificationArea.translations).length, 16);
});
