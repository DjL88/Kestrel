import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSwitchDoc, setOwnerSwitches, SwitchedOffError } from '../core/featureSwitches.ts';
import { sha256Plain } from '../core/sha256';
import type { OptionalModel } from '../core/optionalModels';
import { downloadOptionalModel, optionalModelStatus, type PackDeps, type PackStore } from './optionalModels.ts';
import { createOffThreadSession } from './offThreadSession.ts';
import { AiReviewError, askForReview, consentFor, type AiProviderSettings } from './aiProviders.ts';

test.afterEach(() => setOwnerSwitches(null));
const off = (id: string) => setOwnerSwitches(parseSwitchDoc({ [id]: { device: false } }));

const payload = new Uint8Array(100).map((_, i) => i);
const pack: OptionalModel = { id: 'birefnet-lite-w16', name: 'Test', job: 'x', licence: 'MIT', source: 'x', tier: 'phone', fallback: 'none', cache: 't-v1', files: { model: { url: '/m.onnx', sha256: sha256Plain(payload), bytes: payload.byteLength } } };
const store = (): PackStore => ({ get: async () => undefined, has: async () => false, put: async () => undefined, remove: async () => undefined });

test('a switched-off pack is hidden, never downloaded (no request), and comes back when switched on', async () => {
  const calls: string[] = [];
  const deps: PackDeps = { store: store(), fetch: (async (u: string) => { calls.push(u); return new Response(new Blob([payload as BlobPart]).stream()); }) as unknown as typeof fetch };
  assert.equal(await optionalModelStatus(pack, deps), 'not-downloaded');
  off('fine-edge-mask');
  assert.equal(await optionalModelStatus(pack, deps), 'unavailable');
  await assert.rejects(downloadOptionalModel(pack, () => undefined, undefined, deps), /not offered/);
  assert.deepEqual(calls, []);
  setOwnerSwitches(parseSwitchDoc({}));
  assert.equal(await optionalModelStatus(pack, deps), 'not-downloaded');
});

test('a switched-off model never starts a session, so loaders fall back as for any failed load', async () => {
  off('subject-mask-model');
  await assert.rejects(createOffThreadSession('u2netp', new Uint8Array([1]), { startWorker: null }), SwitchedOffError);
});

test('a switched-off second opinion makes no request and says so calmly', async () => {
  off('own-ai-second-opinion');
  const settings: AiProviderSettings = { kind: 'gemini', key: 'k', model: '', baseUrl: '', consent: '' } as AiProviderSettings;
  settings.consent = consentFor('v1', settings);
  let called = false;
  await assert.rejects(askForReview(settings, 'v1', 'p', 'AAAA', undefined, (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch),
    (e: unknown) => e instanceof AiReviewError && e.reason === 'switchedOff');
  assert.equal(called, false);
});
