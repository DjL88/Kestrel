/**
 * Pure parts of the on-device SmolVLM2 check: tokenizer, prompt, image preparation and option scoring.
 * No model, network or DOM here, so every step is unit-testable. The ONNX runtime lives in providers/smolvlmRuntime.ts.
 *
 * The model is used only to SCORE a few fixed options (for example dark / bright / good) by next-token probability,
 * never to write free text that could be trusted as an instruction. Options are rotated and averaged because small
 * models favour whichever option is listed first.
 */
export interface TokenizerJson {
  added_tokens: ReadonlyArray<{ id: number; content: string }>;
  model: { vocab: Record<string, number>; merges: ReadonlyArray<string | readonly [string, string]> };
}
export const IMAGE_TOKENS = 64;
export const IMAGE_EDGE = 512;

function byteToUnicode(): Map<number, string> {
  const keep: number[] = [];
  for (let b = 33; b <= 126; b += 1) keep.push(b);
  for (let b = 161; b <= 172; b += 1) keep.push(b);
  for (let b = 174; b <= 255; b += 1) keep.push(b);
  const map = new Map<number, string>();
  let extra = 0;
  for (let b = 0; b < 256; b += 1) map.set(b, String.fromCodePoint(keep.includes(b) ? b : 256 + extra++));
  return map;
}
const SPLIT = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

export interface Tokenizer {
  encode(text: string): number[];
  decode(ids: readonly number[]): string;
  special(content: string): number;
}
/** Byte-level BPE as used by SmolLM2 (individual digits, GPT-2 style splitting). */
export function createTokenizer(json: TokenizerJson): Tokenizer {
  const bytes = byteToUnicode();
  const ranks = new Map<string, number>();
  json.model.merges.forEach((merge, rank) => ranks.set(typeof merge === 'string' ? merge : `${merge[0]} ${merge[1]}`, rank));
  const specials = new Map(json.added_tokens.map((token) => [token.content, token.id]));
  const cache = new Map<string, number[]>();
  const bpe = (word: string): number[] => {
    const hit = cache.get(word);
    if (hit) return hit;
    let parts = Array.from(word);
    while (parts.length > 1) {
      let best = -1, bestRank = Infinity;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const rank = ranks.get(`${parts[i]} ${parts[i + 1]}`);
        if (rank !== undefined && rank < bestRank) { bestRank = rank; best = i; }
      }
      if (best < 0) break;
      parts = [...parts.slice(0, best), parts[best] + parts[best + 1], ...parts.slice(best + 2)];
    }
    const ids = parts.map((part) => {
      const id = json.model.vocab[part];
      if (id === undefined) throw new Error('Tokenizer cannot encode this text.');
      return id;
    });
    cache.set(word, ids);
    return ids;
  };
  const encoder = new TextEncoder();
  const byUnicode = new Map(Array.from(bytes, ([byte, char]) => [char, byte] as const));
  const tokenOf = new Map<number, string>();
  for (const [token, id] of Object.entries(json.model.vocab)) tokenOf.set(id, token);
  return {
    decode(ids) {
      const out: number[] = [];
      for (const id of ids) for (const char of Array.from(tokenOf.get(id) ?? '')) { const byte = byUnicode.get(char); if (byte !== undefined) out.push(byte); }
      return new TextDecoder().decode(Uint8Array.from(out));
    },
    special(content) {
      const id = specials.get(content);
      if (id === undefined) throw new Error(`Missing special token ${content}`);
      return id;
    },
    encode(text) {
      const out: number[] = [];
      // The Digits pre-tokenizer first: every digit stands alone.
      for (const segment of text.split(/(\d)/u)) {
        if (!segment) continue;
        for (const piece of segment.match(SPLIT) ?? []) {
          out.push(...bpe(Array.from(encoder.encode(piece), (b) => bytes.get(b)!).join('')));
        }
      }
      return out;
    },
  };
}

/** Token ids for one image plus one question, in SmolVLM2's chat format. */
export function buildPromptIds(tokenizer: Tokenizer, question: string): number[] {
  const fake = tokenizer.special('<fake_token_around_image>');
  return [
    tokenizer.special('<|im_start|>'), ...tokenizer.encode('User:'),
    fake, tokenizer.special('<global-img>'), ...Array<number>(IMAGE_TOKENS).fill(tokenizer.special('<image>')), fake,
    ...tokenizer.encode(question), tokenizer.special('<end_of_utterance>'), ...tokenizer.encode('\nAssistant:'),
  ];
}

/** RGBA pixels already resized to 512 x 512 -> CHW float32 in [-1, 1]. */
export function pixelValues(rgba: Uint8ClampedArray): Float32Array {
  const plane = IMAGE_EDGE * IMAGE_EDGE;
  if (rgba.length !== plane * 4) throw new Error('Expected a 512 x 512 RGBA image.');
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) out[c * plane + i] = rgba[i * 4 + c] / 255 * 2 - 1;
  }
  return out;
}

export interface ChoiceQuestion { id: string; question: string; options: readonly string[] }
export interface ChoiceScore { best: string; probability: number; margin: number; all: Readonly<Record<string, number>> }

export function softmax(values: readonly number[]): number[] {
  const top = Math.max(...values);
  const e = values.map((v) => Math.exp(v - top));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}
export function rotations(options: readonly string[]): string[][] {
  return options.map((_, shift) => [...options.slice(shift), ...options.slice(0, shift)]);
}
/** Forward and reversed: half the cost of every rotation, and each option is listed first once and last once. */
export const opposingOrders = (options: readonly string[]): string[][] => [[...options], [...options].reverse()];
/** The prompt for one option order. */
export const questionText = (q: ChoiceQuestion, order: readonly string[]) => `${q.question} Answer with one word: ${order.join(', ')}.`;
/** Average the per-order probabilities, so list position cannot decide the answer. */
export function combineChoice(options: readonly string[], perOrder: ReadonlyArray<{ order: readonly string[]; probabilities: readonly number[] }>): ChoiceScore {
  const total = Object.fromEntries(options.map((o) => [o, 0])) as Record<string, number>;
  for (const { order, probabilities } of perOrder) order.forEach((option, i) => { total[option] += probabilities[i] / perOrder.length; });
  const ranked = Object.entries(total).sort((a, b) => b[1] - a[1]);
  return { best: ranked[0][0], probability: ranked[0][1], margin: ranked[0][1] - (ranked[1]?.[1] ?? 0), all: total };
}
