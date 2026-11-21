/**
 * The CLIP text tokenizer (byte-level BPE, 49,408 tokens), run on the device from `models/clip-tokenizer.json`.
 * It must give exactly the numbers the text model was trained on, so it is checked against the reference
 * tokenizer in `clipTokenizer.test.ts`.
 */
export interface ClipTokenizerFile {
  model: { vocab: Record<string, number>; merges: string[] };
}

export const CLIP_CONTEXT = 77;
const START = 49406;
const END = 49407;
// The pre-tokenizer pattern from the tokenizer file: words, single digits and punctuation runs; spaces are dropped.
const PIECES = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/gu;

/** GPT-2's reversible byte to printable-character table. */
function byteTable(): string[] {
  const keep: number[] = [];
  for (let b = 33; b <= 126; b += 1) keep.push(b);
  for (let b = 161; b <= 172; b += 1) keep.push(b);
  for (let b = 174; b <= 255; b += 1) keep.push(b);
  const table: string[] = new Array<string>(256);
  let extra = 0;
  for (let b = 0; b < 256; b += 1) table[b] = String.fromCharCode(keep.includes(b) ? b : 256 + extra++);
  return table;
}

export interface ClipTokenizer {
  /** Token numbers including the start and end marks, at most 77 (the end mark is always kept). */
  encode(text: string): number[];
}

export function createClipTokenizer(file: ClipTokenizerFile): ClipTokenizer {
  const { vocab, merges } = file.model;
  const rank = new Map<string, number>();
  merges.forEach((pair, index) => rank.set(pair, index));
  const bytes = byteTable();
  const encoder = new TextEncoder();
  const cache = new Map<string, number[]>();

  function bpe(piece: string): number[] {
    const hit = cache.get(piece);
    if (hit) return hit;
    const symbols = [...encoder.encode(piece)].map((b) => bytes[b]);
    symbols[symbols.length - 1] += '</w>';
    let word = symbols;
    while (word.length > 1) {
      let best = Infinity;
      let at = -1;
      for (let i = 0; i < word.length - 1; i += 1) {
        const r = rank.get(`${word[i]} ${word[i + 1]}`);
        if (r !== undefined && r < best) { best = r; at = i; }
      }
      if (at < 0) break;
      word = [...word.slice(0, at), word[at] + word[at + 1], ...word.slice(at + 2)];
    }
    const ids = word.map((symbol) => vocab[symbol]).filter((id): id is number => id !== undefined);
    cache.set(piece, ids);
    return ids;
  }

  return {
    encode(text) {
      const cleaned = text.normalize('NFC').replace(/\s+/g, ' ').toLowerCase();
      const ids: number[] = [START];
      for (const piece of cleaned.match(PIECES) ?? []) ids.push(...bpe(piece));
      if (ids.length > CLIP_CONTEXT - 1) ids.length = CLIP_CONTEXT - 1;
      ids.push(END);
      return ids;
    },
  };
}
