import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createClipTokenizer, CLIP_CONTEXT, type ClipTokenizerFile } from './clipTokenizer';

const file = JSON.parse(readFileSync(new URL('../../models/clip-tokenizer.json', import.meta.url), 'utf8')) as ClipTokenizerFile;
const tokenizer = createClipTokenizer(file);

// Expected numbers come from the reference `tokenizers` library run on the same file (see PR notes).
describe('CLIP tokenizer', () => {
  const referenceCases: [string, number[]][] = [
    ['kingfisher on a branch', [49406, 34330, 525, 320, 7998, 49407]],
    ['red car', [49406, 736, 1615, 49407]],
    ['A  Café at DUSK!', [49406, 320, 15304, 536, 19708, 256, 49407]],
    ["it's 2 o'clock, we're here", [49406, 585, 568, 273, 334, 262, 6716, 267, 649, 982, 763, 49407]],
    ['日本の鳥', [49406, 39121, 44353, 21575, 165, 111, 354, 49407]],
    ['a photo of a barn owl in flight', [49406, 320, 1125, 539, 320, 10942, 9899, 530, 3795, 49407]],
  ];
  for (const [text, ids] of referenceCases) {
    it(`matches reference token IDs for ${text}`, () => {
      assert.deepEqual(tokenizer.encode(text), ids);
    });
  }

  it('never exceeds the 77-token context and keeps the end mark', () => {
    const ids = tokenizer.encode('bird '.repeat(200));
    assert.equal(ids.length, CLIP_CONTEXT);
    assert.equal(ids[CLIP_CONTEXT - 1], 49407);
  });

  it('gives only the marks for empty text', () => {
    assert.deepEqual(tokenizer.encode('   '), [49406, 49407]);
  });
});
