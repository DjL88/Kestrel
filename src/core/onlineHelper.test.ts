import test from 'node:test';
import assert from 'node:assert/strict';
import { HELPER_CONSENT_VERSION, HELPER_PROMPT, HELPER_SESSION_CAP, failureMessage, helperPatch, helperReady, parseHelperAnswer, pickModel } from './onlineHelper';

const reply = (data: unknown) => JSON.stringify(data);

test('a good answer is read, and a sure species is capitalised', () => {
  assert.deepEqual(parseHelperAnswer(reply({ kind: 'wildlife', species: 'red kite', scientific: 'Milvus milvus', confidence: 'high', tags: ['in flight', 'moorland'] })),
    { kind: 'wildlife', species: 'Red kite', scientific: 'Milvus milvus', confidence: 'high', tags: ['in flight', 'moorland'] });
  const fenced = '```json\n' + reply({ kind: 'landscape', species: null, scientific: null, confidence: 'medium', tags: [] }) + '\n```';
  assert.equal(parseHelperAnswer(fenced)?.kind, 'landscape');
});

test('a damaged or hostile answer is refused or cleaned, never used as it arrives', () => {
  for (const bad of ['', 'not json', '[]', 'null', reply({ kind: 'robot' }), reply({ species: 'Red kite' }), '{"kind": "wildlife"']) assert.equal(parseHelperAnswer(bad), null, bad);
  const hostile = parseHelperAnswer(reply({ kind: 'wildlife', species: '<script>alert(1)</script>', scientific: 'https://evil.example', confidence: 'high', tags: ['ok', 'visit www.evil.com', 'x'.repeat(80), 7, '{"a":1}'] }))!;
  assert.equal(hostile.species, null, 'markup is not a name');
  assert.equal(hostile.confidence, 'low', 'no name means no confidence');
  assert.deepEqual(hostile.tags, ['ok'], 'links, long text, numbers and braces are dropped');
  const link = parseHelperAnswer(reply({ kind: 'wildlife', species: 'Barn owl', scientific: 'see https://x.org', confidence: 'high', tags: [] }))!;
  assert.deepEqual([link.species, link.scientific], ['Barn owl', null]);
  assert.equal(parseHelperAnswer(reply({ kind: 'wildlife', species: 'Barn owl', confidence: 'certain', tags: [] }))?.confidence, 'low', 'an unknown confidence counts as low');
});

test('a person is only ever classed, never named', () => {
  const person = parseHelperAnswer(reply({ kind: 'people', species: 'Taylor Swift', scientific: 'Homo sapiens', confidence: 'high', tags: ['portrait'] }))!;
  assert.deepEqual([person.kind, person.species, person.scientific, person.confidence], ['people', null, null, 'low']);
  assert.ok(/Never name or describe any real person/.test(HELPER_PROMPT));
});

test('at most three tags, without repeats', () => {
  assert.deepEqual(parseHelperAnswer(reply({ kind: 'wildlife', species: null, confidence: 'low', tags: ['a', 'A', 'b', 'c', 'd'] }))!.tags, ['a', 'b', 'c']);
});

test('only a sure answer tags a photo, only a photo with no tags, and only a confident kind sets the kind', () => {
  const sure = { kind: 'wildlife' as const, species: 'Red kite', scientific: 'Milvus milvus', confidence: 'high' as const, tags: ['in flight'] };
  assert.deepEqual(helperPatch({}, sure), { speciesChecked: true, subjectKind: 'wildlife', tags: ['Red kite'], autoTags: ['Red kite'] });
  assert.deepEqual(helperPatch({}, { ...sure, confidence: 'medium' }), { speciesChecked: true, subjectKind: 'wildlife' }, 'a medium answer sets the kind but not a tag');
  assert.deepEqual(helperPatch({}, { ...sure, confidence: 'low' }), { speciesChecked: true }, 'a guess changes nothing');
  assert.deepEqual(helperPatch({ tags: ['Moorland'] }, sure), { speciesChecked: true, subjectKind: 'wildlife' }, 'your own tags are never added to');
  assert.deepEqual(helperPatch({ declinedTags: ['Red kite'] }, sure), { speciesChecked: true, subjectKind: 'wildlife' }, 'a removed name is not put back');
  assert.deepEqual(helperPatch({ subjectKind: 'other' }, sure).subjectKind, undefined, 'a kind you chose is kept');
  assert.deepEqual(helperPatch({}, { kind: 'landscape', species: null, scientific: null, confidence: 'high', tags: [] }), { speciesChecked: true, subjectKind: 'landscape' });
  assert.deepEqual(helperPatch({}, { ...sure, kind: 'other', species: 'Osprey' }), { speciesChecked: true, subjectKind: 'other' },
    'an answer that is not wildlife never becomes a species name, even if one is offered');
});

test('the model is chosen from what the key can use: newest flash, stable before preview, never lite or special-purpose', () => {
  const m = (name: string, methods = ['generateContent']) => ({ name: `models/${name}`, supportedGenerationMethods: methods });
  assert.equal(pickModel([m('gemini-2.5-flash'), m('gemini-3.7-flash'), m('gemini-3.6-flash')]), 'gemini-3.7-flash');
  assert.equal(pickModel([m('gemini-3.7-flash-lite'), m('gemini-3.5-flash')]), 'gemini-3.5-flash', 'lite is not used');
  assert.equal(pickModel([m('gemini-4.0-flash-preview'), m('gemini-3.7-flash')]), 'gemini-3.7-flash', 'stable beats a preview');
  assert.equal(pickModel([m('gemini-4.0-flash-preview')]), 'gemini-4.0-flash-preview', 'a preview is better than nothing');
  assert.equal(pickModel([m('gemini-3.7-flash-image'), m('gemini-3.7-flash-live'), m('gemini-3.7-flash', ['countTokens']), m('gemini-3.7-pro')]), null);
  assert.equal(pickModel([m('gemini-2.10-flash'), m('gemini-2.9-flash')]), 'gemini-2.10-flash', 'versions compare as numbers, not text');
  assert.equal(pickModel([]), null);
});

test('the helper only runs with consent to these terms, a key, the switch on, and a connection', () => {
  const on = { enabled: true, consent: HELPER_CONSENT_VERSION, key: 'abc' };
  assert.equal(helperReady(on, { online: true }), true);
  assert.equal(helperReady(on, { online: false }), false);
  assert.equal(helperReady({ ...on, enabled: false }, { online: true }), false);
  assert.equal(helperReady({ ...on, consent: null }, { online: true }), false);
  assert.equal(helperReady({ ...on, consent: 'gemini-1' }, { online: true }), false, 'older terms ask again');
  assert.equal(helperReady({ ...on, key: '  ' }, { online: true }), false);
  assert.ok(HELPER_SESSION_CAP > 0 && HELPER_SESSION_CAP <= 200);
});

test('a bad key or a rate limit stops the run, but one blocked photo does not', () => {
  assert.equal(failureMessage('auth').stops, true);
  assert.equal(failureMessage('rate').stops, true);
  assert.equal(failureMessage('blocked').stops, false);
  assert.equal(failureMessage('other').stops, false);
  assert.match(failureMessage('auth').text, /key/);
});
