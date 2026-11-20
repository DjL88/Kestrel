import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_REVIEW_CONSENT_VERSION } from '../core/aiReview';
import { askForReview, buildAiRequest, consentFor, destinationHost, readAiAnswer, staysOnThisComputer, AiReviewError, type AiProviderSettings } from './aiProviders';

const answer = JSON.stringify({ summary: 'Natural colour.', points: [], suggestion: { warmth: -0.2 } });
const local: AiProviderSettings = { kind: 'openai', key: '', model: 'llava', baseUrl: 'http://localhost:11434/v1', consent: null };
const agreed = (settings: AiProviderSettings): AiProviderSettings => ({ ...settings, consent: consentFor(AI_REVIEW_CONSENT_VERSION, settings) });

test('each provider names where the preview goes; a local model stays on this computer', () => {
  assert.equal(destinationHost({ kind: 'gemini' }), 'generativelanguage.googleapis.com');
  assert.equal(destinationHost({ kind: 'vertex' }), 'aiplatform.googleapis.com');
  assert.equal(destinationHost({ kind: 'anthropic' }), 'api.anthropic.com');
  assert.equal(destinationHost(local), 'localhost:11434');
  assert.equal(staysOnThisComputer(local), true);
  assert.equal(staysOnThisComputer({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' }), false);
  assert.equal(staysOnThisComputer({ kind: 'gemini' }), false);
});

test('requests carry the image and the question, the key only in a header, and nothing else about the photo', () => {
  const gemini = buildAiRequest({ kind: 'gemini', key: 'k1', model: 'models/gemini-x', consent: null }, 'Q', 'AAAA');
  assert.equal(gemini.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
  assert.equal((gemini.init.headers as Record<string, string>)['x-goog-api-key'], 'k1');
  assert.ok(!gemini.url.includes('k1'), 'the key never goes in the address');
  const vertex = buildAiRequest({ kind: 'vertex', key: 'k2', model: 'gemini-y', consent: null }, 'Q', 'AAAA');
  assert.equal(vertex.url, 'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-y:generateContent');
  const openai = buildAiRequest({ ...local, key: 'sk' }, 'Q', 'AAAA');
  assert.equal(openai.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal((openai.init.headers as Record<string, string>).authorization, 'Bearer sk');
  const body = JSON.parse(openai.init.body as string);
  assert.equal(body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
  assert.equal((buildAiRequest(local, 'Q', 'A').init.headers as Record<string, string>).authorization, undefined, 'no key, no header');
});

test('answers are read from each reply shape; a safety refusal is reported as refused', () => {
  assert.equal(readAiAnswer('gemini', { candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }] }), '{"a":1}');
  assert.equal(readAiAnswer('openai', { choices: [{ message: { content: 'x' } }] }), 'x');
  assert.equal(readAiAnswer('openai', { nope: 1 }), null);
  assert.throws(() => readAiAnswer('gemini', { candidates: [{ finishReason: 'SAFETY' }] }), AiReviewError);
  assert.throws(() => readAiAnswer('openai', { choices: [{ message: { refusal: 'no' } }] }), AiReviewError);
});

test('nothing is sent without agreement to this exact destination', async () => {
  let calls = 0;
  const fetcher = (async () => { calls += 1; return new Response('{}'); }) as typeof fetch;
  await assert.rejects(askForReview(local, AI_REVIEW_CONSENT_VERSION, 'Q', 'A', undefined, fetcher), /AiReviewError|setup/);
  // Agreement for one address doesn't cover another.
  const moved = { ...agreed(local), baseUrl: 'https://elsewhere.example/v1' };
  await assert.rejects(askForReview(moved, AI_REVIEW_CONSENT_VERSION, 'Q', 'A', undefined, fetcher));
  assert.equal(calls, 0);
});

test('a checked review comes back; a bad key or a garbled answer is said plainly', async () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  const review = await askForReview(agreed(local), AI_REVIEW_CONSENT_VERSION, 'Q', 'A', undefined, reply(200, { choices: [{ message: { content: answer } }] }));
  assert.deepEqual(review.suggestion, { warmth: -0.2 });
  await assert.rejects(askForReview(agreed(local), AI_REVIEW_CONSENT_VERSION, 'Q', 'A', undefined, reply(401, {})), (error: AiReviewError) => error.reason === 'key');
  await assert.rejects(askForReview(agreed(local), AI_REVIEW_CONSENT_VERSION, 'Q', 'A', undefined, reply(200, { choices: [{ message: { content: 'not json' } }] })), (error: AiReviewError) => error.reason === 'unreadable');
});
