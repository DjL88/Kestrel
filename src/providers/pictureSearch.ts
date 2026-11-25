import { CLIP_TEXT } from '../core/optionalModels';
import { createClipTokenizer, type ClipTokenizer, type ClipTokenizerFile } from '../core/clipTokenizer';
import { isSearchable, normaliseQuery, rankByQuery, readVector } from '../core/textSearch';
import { normalise } from '../core/speciesMatch';
import type { PhotoFrame } from '../core/types';
import { friendlyToolError } from '../core/toolErrors';
import { createTimedSession } from './modelTiming';
import { downloadOptionalModel, optionalModelStatus, readOptionalModelFile, removeOptionalModel, type OptionalModelStatus } from './optionalModels';

/**
 * Search by description, on this device. The typed words go through the CLIP text model (the opt-in `CLIP_TEXT` pack)
 * and are compared with each photo's picture vector, which the scene-tag pass keeps (`pictureVector`). No network: the
 * pack is downloaded only when the photographer chooses it in Settings → Models, and the tokenizer ships with the app.
 * Without the pack, search by names, species, vehicles and tags keeps working (`wordSearch.ts`).
 */
export const pictureSearchStatus = (): Promise<OptionalModelStatus> => optionalModelStatus(CLIP_TEXT);
export const downloadPictureSearch = (onProgress: (fraction: number) => void, signal?: AbortSignal) =>
  downloadOptionalModel(CLIP_TEXT, onProgress, signal);
export async function removePictureSearch(): Promise<void> { loading = null; await removeOptionalModel(CLIP_TEXT); }

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession; tokenizer: ClipTokenizer }
let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const bytes = await readOptionalModelFile(CLIP_TEXT, 'model');
    const tokenizerFile = (await import('../../models/clip-tokenizer.json')).default as unknown as ClipTokenizerFile;
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await createTimedSession(ort, CLIP_TEXT.id, bytes, { executionProviders: ['wasm'] });
    return { ort, session, tokenizer: createClipTokenizer(tokenizerFile) };
  })().catch((error) => {
    loading = null;
    console.warn('Search by description could not load', error);
    throw new Error(friendlyToolError(error, 'search by description'));
  });
  return loading;
}

const cache = new Map<string, Float32Array>();

/** The description's unit-length vector, the same way the committed scene vectors were made (lower case, no padding). */
export async function describeVector(query: string): Promise<Float32Array> {
  const text = normaliseQuery(query);
  const hit = cache.get(text);
  if (hit) return hit;
  const { ort, session, tokenizer } = await load();
  const ids = tokenizer.encode(text);
  const input = new ort.Tensor('int64', BigInt64Array.from(ids.map((id) => BigInt(id))), [1, ids.length]);
  const results = await session.run({ input_ids: input });
  const output = results.text_embeds ?? results[session.outputNames[0]];
  const vector = normalise(Float32Array.from(output.data as Float32Array));
  if (cache.size > 50) cache.clear();
  cache.set(text, vector);
  return vector;
}

/**
 * The photos whose picture matches the description, best first, or null when search by description is not on this
 * device (then only words are searched). Photos without a picture vector yet are simply not found this way.
 */
export async function photosMatchingDescription(query: string, frames: readonly PhotoFrame[]): Promise<string[] | null> {
  if (!isSearchable(query) || (await pictureSearchStatus()) !== 'ready') return null;
  const vector = await describeVector(query);
  return rankByQuery(vector, frames.filter((frame) => frame.removedAt == null)
    .map((frame) => ({ id: frame.id, vector: readVector(frame.pictureVector) }))).map((match) => match.id);
}
