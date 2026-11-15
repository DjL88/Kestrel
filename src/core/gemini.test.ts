import test from 'node:test';
import assert from 'node:assert/strict';
import { GEMINI_BASE, geminiRequest, readGeminiResponse, readModelList } from './gemini';

const ok = (data: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }] });

test('the request carries one small JPEG, asks for JSON in a fixed shape, and never contains the key', () => {
  const { url, body } = geminiRequest('gemini-3.7-flash', 'QUJD');
  assert.equal(url, `${GEMINI_BASE}/models/gemini-3.7-flash:generateContent`);
  const parts = body.contents[0].parts as { text?: string; inlineData?: { mimeType: string; data: string } }[];
  assert.deepEqual(parts[1].inlineData, { mimeType: 'image/jpeg', data: 'QUJD' });
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.temperature, 0);
  assert.ok(!JSON.stringify({ url, body }).includes('x-goog-api-key'));
  assert.equal(geminiRequest('odd/model?x=1', 'QQ').url.includes('?'), false, 'a model name cannot change the address');
});

test('a good reply becomes an answer', () => {
  const read = readGeminiResponse(200, ok({ kind: 'wildlife', species: 'Barn owl', scientific: 'Tyto alba', confidence: 'high', tags: ['perched'] }));
  assert.ok('answer' in read);
  assert.equal(read.answer.species, 'Barn owl');
});

test('each way it can go wrong gets its own reason', () => {
  assert.deepEqual(readGeminiResponse(429, { error: { status: 'RESOURCE_EXHAUSTED' } }), { failure: 'rate' });
  assert.deepEqual(readGeminiResponse(401, {}), { failure: 'auth' });
  assert.deepEqual(readGeminiResponse(403, { error: { status: 'PERMISSION_DENIED' } }), { failure: 'auth' });
  assert.deepEqual(readGeminiResponse(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }), { failure: 'auth' });
  assert.deepEqual(readGeminiResponse(500, { error: { message: 'oops' } }), { failure: 'other' });
  assert.deepEqual(readGeminiResponse(200, { promptFeedback: { blockReason: 'SAFETY' } }), { failure: 'blocked' });
  assert.deepEqual(readGeminiResponse(200, { candidates: [{ finishReason: 'SAFETY' }] }), { failure: 'blocked' });
  assert.deepEqual(readGeminiResponse(200, { candidates: [] }), { failure: 'blocked' });
  assert.deepEqual(readGeminiResponse(200, { candidates: [{ content: { parts: [{ text: 'sorry, no' }] } }] }), { failure: 'other' });
  assert.deepEqual(readGeminiResponse(200, 'nonsense'), { failure: 'other' });
  assert.deepEqual(readGeminiResponse(200, ok({ kind: 'robot' })), { failure: 'other' });
});

test('the model list is read safely', () => {
  assert.deepEqual(readModelList({ models: [{ name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent', 7] }, { name: 3 }, null, { name: 'x'.repeat(500) }] }),
    [{ name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] }]);
  assert.deepEqual(readModelList(null), []);
  assert.deepEqual(readModelList({ models: 'no' }), []);
});
