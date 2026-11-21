import { Sha256Stream } from '../core/sha256';
import { createClipTokenizer, type ClipTokenizer, type ClipTokenizerFile } from '../core/clipTokenizer';
import { normalise } from '../core/speciesMatch';
import { friendlyToolError } from '../core/toolErrors';
import { isDesktopApp } from './desktopShell';
import { getModel, hasModel, putModel } from './modelStore';
import { gateAvailable } from './categoryGate';

/**
 * The CLIP text encoder that pairs with the category gate's image encoder (Xenova/clip-vit-base-patch32,
 * onnx/text_model_int8.onnx, MIT). Its weights are not in git. A build that ships or hosts the file at `url` gets
 * search by description; every other build quietly keeps the plain-words search.
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
export const TEXT_MODEL = {
  url: env?.VITE_TEXT_MODEL_URL ?? '/models/clip-vit-b32-text-int8.onnx',
  sha256: env?.VITE_TEXT_MODEL_SHA256 ?? '18845f2ccc35223bb7fec403383a131154b11ac0918df25cf51986df5efd3a21',
  bytes: Number(env?.VITE_TEXT_MODEL_BYTES ?? 64070791),
  cache: 'kestrel-species-v1',
} as const;

export type TextSearchStatus = 'words-only' | 'not-downloaded' | 'ready';

async function fileIsServed(): Promise<boolean> {
  try {
    const head = await fetch(TEXT_MODEL.url, { method: 'HEAD' });
    return head.ok && !(head.headers.get('content-type') ?? '').includes('html') && Number(head.headers.get('content-length')) === TEXT_MODEL.bytes;
  } catch { return false; }
}

/** Never throws. Needs the picture encoder on the device too. */
export async function textSearchStatus(): Promise<TextSearchStatus> {
  try {
    if (!(await gateAvailable().catch(() => false)) && !(await hasModel(TEXT_MODEL.cache, TEXT_MODEL.url))) {
      // A browser without the picture encoder cannot search by description yet.
      if (!isDesktopApp()) return 'words-only';
    }
    if (await hasModel(TEXT_MODEL.cache, TEXT_MODEL.url)) return 'ready';
    if (isDesktopApp()) return (await fileIsServed()) ? 'ready' : 'words-only';
    return (await fileIsServed()) ? 'not-downloaded' : 'words-only';
  } catch { return 'words-only'; }
}

/** Opt-in download in a browser: checked as it arrives, then kept for offline use. Progress is 0 to 1. */
export async function downloadTextModel(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  if (await hasModel(TEXT_MODEL.cache, TEXT_MODEL.url)) { onProgress(1); return; }
  const response = await fetch(TEXT_MODEL.url, { signal });
  if (!response.ok || !response.body) throw new Error('The download did not finish. Try again later.');
  const reader = response.body.getReader();
  const hash = new Sha256Stream();
  const pieces: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    hash.update(value); pieces.push(value); received += value.length;
    onProgress(Math.min(0.98, received / TEXT_MODEL.bytes));
  }
  if (received !== TEXT_MODEL.bytes || hash.digest() !== TEXT_MODEL.sha256) throw new Error('The download did not check out, so it was not kept. Try again.');
  await putModel(TEXT_MODEL.cache, TEXT_MODEL.url, new Blob(pieces as BlobPart[], { type: 'application/octet-stream' }));
  onProgress(1);
}

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession; tokenizer: ClipTokenizer }
let loading: Promise<Loaded> | null = null;
const queries = new Map<string, Float32Array>();

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const stored = await getModel(TEXT_MODEL.cache, TEXT_MODEL.url).catch(() => undefined);
    const bytes = stored ? new Uint8Array(await stored.arrayBuffer()) : await fetch(TEXT_MODEL.url).then(async (r) => {
      if (!r.ok) throw new Error('missing');
      return new Uint8Array(await r.arrayBuffer());
    });
    const hash = new Sha256Stream();
    hash.update(bytes);
    if (bytes.byteLength !== TEXT_MODEL.bytes || hash.digest() !== TEXT_MODEL.sha256) throw new Error('The search model failed its integrity check, so it was not used.');
    const [file, ort] = await Promise.all([import('../../models/clip-tokenizer.json'), import('onnxruntime-web/wasm')]);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    return { ort, session, tokenizer: createClipTokenizer(file.default as unknown as ClipTokenizerFile) };
  })().catch((error) => { loading = null; console.warn('Search model failed to load', error); throw new Error(friendlyToolError(error, 'search model')); });
  return loading;
}

/** The unit-length vector for typed words. Remembered for the session, so retyping is instant. */
export async function embedQuery(query: string): Promise<Float32Array> {
  const hit = queries.get(query);
  if (hit) return hit;
  const { ort, session, tokenizer } = await load();
  const ids = BigInt64Array.from(tokenizer.encode(query).map(BigInt));
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('int64', ids, [1, ids.length]) });
  const vector = normalise(Float32Array.from(out[session.outputNames[0]].data as Float32Array));
  if (queries.size > 50) queries.clear();
  queries.set(query, vector);
  return vector;
}
