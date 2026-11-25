/**
 * Replies from the model session worker (src/providers/modelSessionWorker.ts) to src/providers/offThreadSession.ts:
 *   { type: 'ready', loadMs, inputNames, outputNames }      or { type: 'error', message }
 *   { type: 'result', id, outputs: { name: { data, dims } }, runMs } or { type: 'error', id, message }
 * A reply without exactly the expected shape is refused, so a broken worker can never pass off a wrong or partial
 * answer as a subject outline or a similarity embedding. Only float32 outputs are carried: both models that use this
 * worker (U2-Net and DINOv2) answer in float32, and the worker leaves any other output out on purpose.
 */
export interface ModelTensor { data: Float32Array; dims: readonly number[] }
/** An input: float32, or int64 for sizes and counts (EfficientSAM's original image size). Outputs stay float32. */
export interface ModelInput { data: Float32Array | BigInt64Array; dims: readonly number[] }

const time = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const names = (value: unknown): string[] | null =>
  Array.isArray(value) && value.length > 0 && value.every((name) => typeof name === 'string' && name.length > 0) ? value : null;

export function readModelReady(message: unknown): { loadMs: number | null; inputNames: string[]; outputNames: string[] } {
  const m = message as { type?: unknown; loadMs?: unknown; inputNames?: unknown; outputNames?: unknown; message?: unknown } | null;
  if (m?.type === 'error') throw new Error(typeof m.message === 'string' && m.message ? m.message : 'The model could not be loaded.');
  const inputNames = names(m?.inputNames), outputNames = names(m?.outputNames);
  if (m?.type !== 'ready' || !inputNames || !outputNames) throw new Error('The model loaded with an unexpected description.');
  return { loadMs: time(m.loadMs), inputNames, outputNames };
}

/** A run's answer: every expected output present, float32, and as long as its dimensions say. */
export function readModelResult(message: unknown, expectedOutputs: readonly string[]): { outputs: Record<string, ModelTensor>; runMs: number | null } {
  const m = message as { type?: unknown; outputs?: unknown; runMs?: unknown; message?: unknown } | null;
  if (m?.type === 'error') throw new Error(typeof m.message === 'string' && m.message ? m.message : 'The model failed.');
  if (m?.type !== 'result' || !m.outputs || typeof m.outputs !== 'object') throw new Error('The model returned an unexpected result.');
  const raw = m.outputs as Record<string, unknown>;
  const outputs: Record<string, ModelTensor> = {};
  for (const name of expectedOutputs) {
    const tensor = raw[name] as { data?: unknown; dims?: unknown } | undefined;
    const dims = tensor?.dims;
    if (!tensor || !(tensor.data instanceof Float32Array) || !Array.isArray(dims)
      || !dims.every((d) => Number.isInteger(d) && d >= 0)
      || dims.reduce((n: number, d: number) => n * d, 1) !== tensor.data.length) {
      throw new Error('The model returned an unexpected result.');
    }
    outputs[name] = { data: tensor.data, dims };
  }
  return { outputs, runMs: time(m.runMs) };
}
