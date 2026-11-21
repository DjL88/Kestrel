import test from 'node:test';
import assert from 'node:assert/strict';
import { VERIFY_COLOUR_PROMPT, parseColourVerification } from './colourVerification';

const reply = (data: unknown) => JSON.stringify(data);

test('a plausible answer clears any concerns the model also sent, even by mistake', () => {
  assert.deepEqual(parseColourVerification(reply({ plausible: true, concerns: ['clipping'], note: null })), { plausible: true, concerns: [], note: null });
  const fenced = '```json\n' + reply({ plausible: true }) + '\n```';
  assert.deepEqual(parseColourVerification(fenced), { plausible: true, concerns: [], note: null });
});

test('an implausible answer keeps at most two known concerns, without repeats, and drops anything unknown', () => {
  const answer = parseColourVerification(reply({ plausible: false, concerns: ['skinTone', 'skinTone', 'clipping', 'invented', 'other'], note: 'Shadows read strongly green.' }));
  assert.deepEqual(answer, { plausible: false, concerns: ['skinTone', 'clipping'], note: 'Shadows read strongly green.' });
});

test('a damaged, hostile or incomplete answer is refused or cleaned, never used as it arrives', () => {
  for (const bad of ['', 'not json', '[]', 'null', reply({}), reply({ concerns: ['clipping'] }), '{"plausible": true']) assert.equal(parseColourVerification(bad), null, bad);
  const hostile = parseColourVerification(reply({ plausible: false, concerns: ['oversaturated'], note: '<script>alert(1)</script>' }))!;
  assert.equal(hostile.note, null, 'markup is not a note');
  const link = parseColourVerification(reply({ plausible: false, concerns: ['flat'], note: 'see https://evil.example' }))!;
  assert.equal(link.note, null, 'a link is not a note');
  const long = parseColourVerification(reply({ plausible: false, concerns: [], note: 'x'.repeat(200) }))!;
  assert.equal(long.note, null, 'far too long to be a short plain sentence');
});

test('the prompt is explicit that this sits alongside the measured check, not in place of it', () => {
  assert.ok(/second opinion/i.test(VERIFY_COLOUR_PROMPT));
  assert.ok(/measured colour check/i.test(VERIFY_COLOUR_PROMPT));
});
