import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createClipTokenizer, CLIP_CONTEXT, type ClipTokenizerFile } from './clipTokenizer';

const file = JSON.parse(readFileSync(new URL('../../models/clip-tokenizer.json', import.meta.url), 'utf8')) as ClipTokenizerFile;
const tokenizer = createClipTokenizer(file);

// Expected numbers come from the reference `tokenizers` library run on the same file (see PR notes).
describe('CLIP tokenizer', () => {
  it.each([
    ['kingfisher on a branch', [49406, 34330, 525, 320, 7998, 49407]],
    ['red car', [49406, 736, 1615, 49407]],
    ['A  Café at DUSK!', [49406, 320, 15304, 536, 19708, 256, 49407]],
    ["it's 2 o'clock, we're here", [49406, 585, 568, 273, 334, 262, 6716, 267, 649, 982, 763, 49407]],
    ['日本の鳥', [49406, 39121, 44353, 21575, 165, 111, 354, 49407]],
    ['a photo of a barn owl in flight', [49406, 320, 1125, 539, 320, 10942, 9899, 530, 3795, 49407]],
  ])('matches the reference for %s', (text, ids) => {
    expect(tokenizer.encode(text)).toEqual(ids);
  });

  it('never exceeds the 77-token context and keeps the end mark', () => {
    const ids = tokenizer.encode('bird '.repeat(200));
    expect(ids).toHaveLength(CLIP_CONTEXT);
    expect(ids[CLIP_CONTEXT - 1]).toBe(49407);
  });

  it('gives only the marks for empty text', () => {
    expect(tokenizer.encode('   ')).toEqual([49406, 49407]);
  });
});
