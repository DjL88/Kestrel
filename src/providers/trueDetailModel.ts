import { installedModel } from './modelUpdater';
import { TRUEDETAIL_TILE, type TileInference } from '../core/trueDetailTiles';
import { sha256Hex } from '../core/sha256';
import { prepareDenoiseInput, type DenoiseInputContract } from '../core/trueDetailNoiseInput';
import { createOrtSession, loadOrt } from './ortRuntime';

/** Review must cover the weight file's licence, exact tensor contract and
 * photographic quality. A signed download alone does not prove any of these.
 * No model is approved or released yet; never use a guessed hash or model.
 */
const APPROVED: Readonly<Record<string, {sha256: string; licence: string; contract: DenoiseInputContract}>> = Object.freeze({});

export interface TrueDetailSession {
  infer: TileInference;
  close(): Promise<void>;
}

/** Load only an installed, explicitly reviewed weight file. No photo upload. */
export async function openTrueDetailModel(sigma?: number): Promise<TrueDetailSession | null> {
  const approval = APPROVED['truedetail-rgb16-v1'];
  if (!approval) return null;
  const model = await installedModel('truedetail-rgb16-v1');
  if (!model || model.sha256 !== approval.sha256 || await sha256Hex(model.bytes) !== approval.sha256) return null;
  const ort = await loadOrt();
  const session = await createOrtSession(ort, new Uint8Array(model.bytes));
  if (session.inputNames.length !== 1 || session.outputNames.length !== 1) {
    await session.release();
    throw new Error('Unsupported TrueDetail model interface');
  }
  let closed = false, busy = false;
  return {
    async infer(input, signal) {
      if (closed || busy) throw new Error('TrueDetail session unavailable');
      signal?.throwIfAborted();
      const size = TRUEDETAIL_TILE;
      if (input.length !== 3*size*size) throw new Error('Invalid TrueDetail input shape');
      const prepared = prepareDenoiseInput(input, approval.contract, sigma);
      const tensor = new ort.Tensor('float32',prepared.data,[1,prepared.channels,size,size]);
      busy = true;
      try {
        const outputs = await session.run({[session.inputNames[0]]:tensor});
        try {
          signal?.throwIfAborted();
          const output = outputs[session.outputNames[0]];
          if (!output || output.type !== 'float32' || output.dims.join(',') !== [1,3,size,size].join(',') ||
              !(output.data instanceof Float32Array)) throw new Error('Unsupported TrueDetail output tensor');
          return output.data.slice();
        } finally { for (const output of Object.values(outputs)) output.dispose(); }
      } finally { tensor.dispose(); busy = false; }
    },
    async close() {
      if (busy) throw new Error('Cannot close active TrueDetail inference');
      if (!closed) { closed = true; await session.release(); }
    },
  };
}
