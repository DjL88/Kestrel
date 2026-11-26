/**
 * How the on-device models run: how many CPU threads onnxruntime may use, and whether to try the graphics card first.
 *
 * Today's path, kept on the web and on phones: one WebAssembly thread per runtime, which needs no cross-origin
 * isolation and works on every host and offline. The desktop app is served cross-origin isolated (COOP/COEP in
 * src-tauri/tauri.conf.json), so there SharedArrayBuffer exists and onnxruntime can spread one model over 2 to 4
 * threads. The page reports `crossOriginIsolated` itself, so a desktop build that somehow loses the headers (the dev
 * server, an older WebView) simply stays on one thread. Nothing here changes a model's answer, only how fast it comes.
 *
 * WebGPU is tried only where all three hold: desktop, isolated, and the device preview switch is on
 * (`localStorage['kestrel.preview.ort-webgpu.v1'] = '1'`), because its float maths is not yet proven to give the
 * same calibrated answers as the CPU path on Dave's machines. When it is tried, the CPU path is always the fallback.
 */

export interface OrtHost {
  /** The installed desktop app (Tauri on Windows or macOS), not a phone shell. */
  desktop: boolean;
  /** The page or worker is cross-origin isolated, so SharedArrayBuffer and WebAssembly threads work. */
  isolated: boolean;
  /** navigator.hardwareConcurrency, or anything not finite when unknown. */
  cores: number;
  /** navigator.gpu exists. */
  webgpu?: boolean;
  /** The device preview switch for WebGPU is on. */
  webgpuPreview?: boolean;
}

export interface OrtPlan {
  threads: number;
  /** In order of preference; always ends with 'wasm'. */
  executionProviders: Array<'webgpu' | 'wasm'>;
}

export const ORT_WEBGPU_PREVIEW_KEY = 'kestrel.preview.ort-webgpu.v1';
export const ORT_MAX_THREADS = 4;
export const ORT_SINGLE_THREAD: OrtPlan = Object.freeze({ threads: 1, executionProviders: ['wasm'] }) as OrtPlan;

/**
 * Threads for one onnxruntime instance. `runtimes` is how many instances share the machine at once (the detector runs
 * one per worker): the cores, less one for the interface, are shared between them, so several workers never
 * oversubscribe the CPU. Between 1 and 4; 1 everywhere except an isolated desktop app.
 */
export function ortThreadCount(host: OrtHost, runtimes = 1): number {
  if (!host.desktop || !host.isolated) return 1;
  const cores = Number.isFinite(host.cores) && host.cores >= 1 ? Math.floor(host.cores) : 2;
  const share = Math.floor((cores - 1) / Math.max(1, Math.floor(runtimes)));
  return Math.max(1, Math.min(ORT_MAX_THREADS, share));
}

export function ortPlanFor(host: OrtHost, runtimes = 1): OrtPlan {
  const threads = ortThreadCount(host, runtimes);
  const gpu = host.desktop && host.isolated && host.webgpu === true && host.webgpuPreview === true;
  return { threads, executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'] };
}

/** A plan that arrived in a worker message: anything unexpected falls back to today's single-thread CPU path. */
export function readOrtPlan(value: unknown): OrtPlan {
  if (!value || typeof value !== 'object') return ORT_SINGLE_THREAD;
  const { threads, executionProviders } = value as Partial<OrtPlan>;
  const count = typeof threads === 'number' && Number.isInteger(threads) ? Math.max(1, Math.min(ORT_MAX_THREADS, threads)) : 1;
  const gpu = Array.isArray(executionProviders) && executionProviders[0] === 'webgpu';
  return { threads: count, executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'] };
}

