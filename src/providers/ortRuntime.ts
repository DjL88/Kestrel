import { previewOn } from '../core/previewFeatures';
import { ortPlanFor, ortWorkerPlanFor, readOrtPlan, type OrtPlan } from '../core/ortThreads';
import { isDesktopApp, isMobileShell } from './desktopShell';

/**
 * The one place every on-device model gets its onnxruntime from (src/core/ortThreads.ts decides threads and WebGPU).
 * The runtime's thread count is fixed when its WebAssembly first starts, so every model on this thread must ask the
 * same plan: `ortPlanHere()` is worked out once per thread and kept. Workers have no window, so the page works out
 * their plan and sends it in the worker's `init` message (`ortPlanForWorkers`), and the worker reads it back with
 * `readOrtPlan`. Web and phones always get today's single-thread CPU path.
 */
export type Ort = typeof import('onnxruntime-web/wasm');
type Options = Parameters<Ort['InferenceSession']['create']>[1];
type Session = import('onnxruntime-web/wasm').InferenceSession;

function webgpuPreviewOn(): boolean {
  return previewOn('ortWebgpu');
}

function planHere(runtimes: number, inWorker = false): OrtPlan {
  const scope = globalThis as { crossOriginIsolated?: boolean; navigator?: Navigator & { gpu?: unknown } };
  return (inWorker ? ortWorkerPlanFor : ortPlanFor)({
    desktop: isDesktopApp() && !isMobileShell(),
    isolated: scope.crossOriginIsolated === true,
    cores: scope.navigator?.hardwareConcurrency ?? Number.NaN,
    webgpu: scope.navigator?.gpu !== undefined,
    webgpuPreview: webgpuPreviewOn(),
  }, runtimes);
}

let mainPlan: OrtPlan | null = null;
/** The plan for models running on this thread. */
export function ortPlanHere(): OrtPlan { return (mainPlan ??= planHere(1)); }
/** The plan to send to each of `workers` background workers that share the machine. */
/** One thread each in the desktop app: a worker there cannot start onnxruntime's own thread workers (ortWorkerPlanFor). */
export function ortPlanForWorkers(workers = 1): OrtPlan { return planHere(workers, true); }

/** onnxruntime for this plan, set up before its first session (WebGPU build only when the plan asks for it). */
export async function loadOrt(plan: OrtPlan = ortPlanHere(), retry = false): Promise<Ort> {
  const load = () => import('onnxruntime-web/wasm');
  let ort: Ort;
  if (plan.executionProviders[0] === 'webgpu') ort = (await import('onnxruntime-web/webgpu').catch(load)) as unknown as Ort;
  else ort = await load().catch(async (problem) => {
    if (!retry) throw problem;
    // A dev server that has just re-optimised its dependencies drops the first dynamic import once.
    await new Promise((resolve) => setTimeout(resolve, 500));
    return load();
  });
  ort.env.wasm.numThreads = plan.threads;
  ort.env.wasm.proxy = false;
  return ort;
}

/** Session options for this plan: the caller's options with the plan's execution providers. */
export function ortOptions(plan: OrtPlan = ortPlanHere(), options: Options = {}): Options {
  return { ...options, executionProviders: [...plan.executionProviders] };
}

/** Create a session; if the graphics card path fails to start, fall back to the CPU path rather than fail the model. */
export async function createOrtSession(ort: Ort, bytes: Uint8Array, options: Options = ortOptions()): Promise<Session> {
  try {
    return await ort.InferenceSession.create(bytes, options);
  } catch (problem) {
    const providers = (options?.executionProviders ?? []) as unknown[];
    if (!providers.includes('webgpu')) throw problem;
    return ort.InferenceSession.create(bytes, { ...options, executionProviders: ['wasm'] });
  }
}

/** For a worker: the plan its page sent, or today's single-thread path when it sent none. */
export { readOrtPlan };

/** For tests. */
export function resetOrtPlan(): void { mainPlan = null; }
