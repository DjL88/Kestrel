import {
  IMAGE_EDGE, IMAGE_TOKENS, buildPromptIds, combineChoice, createTokenizer, pixelValues, questionText, opposingOrders, softmax,
  type ChoiceQuestion, type ChoiceScore, type TokenizerJson,
} from '../core/smolvlm';

type Ort = typeof import('onnxruntime-web/wasm');
export interface SmolVlmFiles { vision: Uint8Array; embed: Uint8Array; decoder: Uint8Array; tokenizer: TokenizerJson }
export interface SmolVlm {
  /** `rgba` is the photo already resized to 512 x 512. Questions are scored against one shared image encoding. */
  score(rgba: Uint8ClampedArray, questions: readonly ChoiceQuestion[], options?: { signal?: AbortSignal }): Promise<Record<string, ChoiceScore>>;
  /** One short greedy description. Free text is only ever searched for fixed keywords, never trusted as an instruction. */
  describe(rgba: Uint8ClampedArray, options?: { signal?: AbortSignal; maxTokens?: number; question?: string }): Promise<string>;
  dispose(): Promise<void>;
}
const LAYERS = 30, KV_HEADS = 3, HEAD_DIM = 64, HIDDEN = 576;

/** SmolVLM2-256M on the app's own onnxruntime-web (CPU WebAssembly, one thread: no cross-origin isolation needed, works offline). */
export async function openSmolVlm(ort: Ort, files: SmolVlmFiles): Promise<SmolVlm> {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const tokenizer = createTokenizer(files.tokenizer);
  const imageId = tokenizer.special('<image>');
  const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' } as const;
  // Load sequentially: three concurrent WASM graph builds can exceed the
  // memory ceiling on mobile browsers. A failed later graph must also release
  // any earlier sessions, rather than leaking hundreds of megabytes.
  const sessions: import('onnxruntime-web/wasm').InferenceSession[] = [];
  let vision: import('onnxruntime-web/wasm').InferenceSession;
  let embed: import('onnxruntime-web/wasm').InferenceSession;
  let decoder: import('onnxruntime-web/wasm').InferenceSession;
  try {
    vision = await ort.InferenceSession.create(files.vision, options);
    sessions.push(vision);
    embed = await ort.InferenceSession.create(files.embed, options);
    sessions.push(embed);
    decoder = await ort.InferenceSession.create(files.decoder, options);
    sessions.push(decoder);
  } catch (error) {
    await Promise.allSettled(sessions.map(session => session.release()));
    throw error;
  }
  const emptyPast = () => {
    const feeds: Record<string, import('onnxruntime-web/wasm').Tensor> = {};
    for (let i = 0; i < LAYERS; i += 1) for (const kind of ['key', 'value']) {
      feeds[`past_key_values.${i}.${kind}`] = new ort.Tensor('float32', new Float32Array(0), [1, KV_HEADS, 0, HEAD_DIM]);
    }
    return feeds;
  };
  const encodeImage = async (rgba: Uint8ClampedArray): Promise<Float32Array> => {
    const out = await vision.run({
      pixel_values: new ort.Tensor('float32', pixelValues(rgba), [1, 1, 3, IMAGE_EDGE, IMAGE_EDGE]),
      pixel_attention_mask: new ort.Tensor('bool', new Uint8Array(IMAGE_EDGE * IMAGE_EDGE).fill(1), [1, 1, IMAGE_EDGE, IMAGE_EDGE]),
    });
    const features = Float32Array.from(out.image_features.data as Float32Array);
    if (features.length !== IMAGE_TOKENS * HIDDEN) throw new Error('Unexpected image feature size from the vision model.');
    return features;
  };
  /** Next-token logits after one whole prompt (this exported decoder only accepts one new token at a time once it has a cache, so no prefix reuse). */
  const lastLogits = async (ids: number[], features: Float32Array): Promise<Float32Array> => {
    const n = ids.length;
    const embedded = await embed.run({ input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, n]) });
    const embeds = Float32Array.from(embedded.inputs_embeds.data as Float32Array);
    let next = 0;
    for (let i = 0; i < n; i += 1) if (ids[i] === imageId) embeds.set(features.subarray(next * HIDDEN, (next + 1) * HIDDEN), i * HIDDEN), next += 1;
    if (next !== IMAGE_TOKENS) throw new Error('Prompt does not hold the expected image tokens.');
    const out = await decoder.run({
      inputs_embeds: new ort.Tensor('float32', embeds, [1, n, HIDDEN]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
      position_ids: new ort.Tensor('int64', BigInt64Array.from({ length: n }, (_, i) => BigInt(i)), [1, n]),
      ...emptyPast(),
    });
    const vocab = out.logits.dims[2];
    return Float32Array.from((out.logits.data as Float32Array).subarray((n - 1) * vocab, n * vocab));
  };
  const describe: SmolVlm['describe'] = async (rgba, run = {}) => {
    const features = await encodeImage(rgba);
    const ids = buildPromptIds(tokenizer, run.question ?? 'Describe this photo in one short sentence.');
    const n = ids.length;
    const embedded = await embed.run({ input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, n]) });
    const embeds = Float32Array.from(embedded.inputs_embeds.data as Float32Array);
    let next = 0;
    for (let i = 0; i < n; i += 1) if (ids[i] === imageId) embeds.set(features.subarray(next * HIDDEN, (next + 1) * HIDDEN), i * HIDDEN), next += 1;
    const stop = tokenizer.special('<end_of_utterance>');
    const generated: number[] = [];
    let feeds: Record<string, import('onnxruntime-web/wasm').Tensor> = emptyPast();
    let pastLength = 0, current = embeds, count = n;
    for (let step = 0; step < (run.maxTokens ?? 32); step += 1) {
      if (run.signal?.aborted) throw new DOMException('Photo check cancelled', 'AbortError');
      const out = await decoder.run({
        inputs_embeds: new ort.Tensor('float32', current, [1, count, HIDDEN]),
        attention_mask: new ort.Tensor('int64', new BigInt64Array(pastLength + count).fill(1n), [1, pastLength + count]),
        position_ids: new ort.Tensor('int64', BigInt64Array.from({ length: count }, (_, i) => BigInt(pastLength + i)), [1, count]),
        ...feeds,
      });
      const vocab = out.logits.dims[2];
      const row = (out.logits.data as Float32Array).subarray((count - 1) * vocab, count * vocab);
      let best = 0;
      for (let i = 1; i < vocab; i += 1) if (row[i] > row[best]) best = i;
      if (best === stop) break;
      generated.push(best);
      feeds = {};
      for (let i = 0; i < LAYERS; i += 1) for (const kind of ['key', 'value']) feeds[`past_key_values.${i}.${kind}`] = out[`present.${i}.${kind}`];
      pastLength += count;
      const token = await embed.run({ input_ids: new ort.Tensor('int64', BigInt64Array.of(BigInt(best)), [1, 1]) });
      current = Float32Array.from(token.inputs_embeds.data as Float32Array);
      count = 1;
    }
    return tokenizer.decode(generated).trim();
  };
  return {
    describe,
    async score(rgba, questions, run = {}) {
      const features = await encodeImage(rgba);
      const result: Record<string, ChoiceScore> = {};
      for (const q of questions) {
        const perOrder = [];
        for (const order of opposingOrders(q.options)) {
          if (run.signal?.aborted) throw new DOMException('Photo check cancelled', 'AbortError');
          const logits = await lastLogits(buildPromptIds(tokenizer, questionText(q, order)), features);
          perOrder.push({ order, probabilities: softmax(order.map((option) => logits[tokenizer.encode(option)[0]])) });
        }
        result[q.id] = combineChoice(q.options, perOrder);
      }
      return result;
    },
    async dispose() { await Promise.all([vision.release(), embed.release(), decoder.release()]); },
  };
}
