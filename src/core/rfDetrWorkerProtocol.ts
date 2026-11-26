/**
 * Messages between the interface thread and the RF-DETR worker (src/providers/rfDetrWorker.ts):
 *   in  { type: 'init', model, ort? } out { type: 'ready', loadMs } or { type: 'error', message }
 *   in  { type: 'run', id, input }     out { type: 'result', id, logits, boxes, runMs } or { type: 'error', id, message }
 * A reply that does not have exactly the expected shape is refused, so a broken worker can never pass off a wrong
 * or partial answer as subjects.
 */
import { RFDETR_INPUT, RFDETR_LOGITS, RFDETR_QUERIES } from './rfDetr';

export const RFDETR_INPUT_LENGTH = 3 * RFDETR_INPUT * RFDETR_INPUT;

export interface RfDetrOutput { logits: Float32Array; boxes: Float32Array; runMs: number | null }

export function readRfDetrResult(message: unknown): RfDetrOutput {
  const m = message as { type?: unknown; logits?: unknown; boxes?: unknown; runMs?: unknown; message?: unknown } | null;
  if (m?.type === 'error') throw new Error(typeof m.message === 'string' && m.message ? m.message : 'The second subject finder failed.');
  if (m?.type !== 'result' || !(m.logits instanceof Float32Array) || !(m.boxes instanceof Float32Array)
    || m.logits.length !== RFDETR_QUERIES * RFDETR_LOGITS || m.boxes.length !== RFDETR_QUERIES * 4) {
    throw new Error('The second subject finder returned an unexpected result.');
  }
  const runMs = typeof m.runMs === 'number' && Number.isFinite(m.runMs) && m.runMs >= 0 ? m.runMs : null;
  return { logits: m.logits, boxes: m.boxes, runMs };
}
