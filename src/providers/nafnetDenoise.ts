import { NAFNET_W32 } from '../core/optionalModels';
import { NAFNET_CANDIDATE, NAFNET_TILE, nafnetOutput, type TrueDetailCandidate } from '../core/nafnet';
import { runTrueDetailTiles, type TileInference, type TrueDetailOptions } from '../core/trueDetailTiles';
import { downloadOptionalModel, optionalModelStatus, readOptionalModelFile, removeOptionalModel, type OptionalModelStatus } from './optionalModels';

/**
 * NAFNet width32: one TrueDetail candidate (owner decision 8), beside the conventional denoise and, later, the
 * owner's trained network. The guardian compares candidates; this module only produces NAFNet's. Nothing runs unless
 * the pack is downloaded and the caller asks; otherwise the conventional candidate is the only one. It is slow in a browser (about 3 s per 256 px tile
 * in single-thread WASM on the Windows laptop), so callers should run it on a region, a preview, or in the
 * background with progress, never silently on a whole large photo.
 */
export const nafnetStatus = (): Promise<OptionalModelStatus> => optionalModelStatus(NAFNET_W32);
export const downloadNafnet = (onProgress: (fraction: number) => void, signal?: AbortSignal) =>
  downloadOptionalModel(NAFNET_W32, onProgress, signal);
export const removeNafnet = () => removeOptionalModel(NAFNET_W32);

export interface NafnetSession { candidate: TrueDetailCandidate; infer: TileInference; close(): Promise<void> }

/** A session for the tile runner, or null when the pack is not downloaded or not offered (use the fallback). */
export async function openNafnet(): Promise<NafnetSession | null> {
  if (await nafnetStatus() !== 'ready') return null;
  const bytes = await readOptionalModelFile(NAFNET_W32, 'model');
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  let closed = false;
  let busy = false;
  return {
    candidate: NAFNET_CANDIDATE,
    async infer(input, signal) {
      if (closed || busy) throw new Error('The learned denoise is not available right now.');
      signal?.throwIfAborted();
      if (input.length !== 3 * NAFNET_TILE * NAFNET_TILE) throw new Error('Invalid denoise input shape');
      const tensor = new ort.Tensor('float32', input, [1, 3, NAFNET_TILE, NAFNET_TILE]);
      busy = true;
      try {
        const outputs = await session.run({ input: tensor });
        try {
          signal?.throwIfAborted();
          return nafnetOutput(outputs.output.data as Float32Array);
        } finally { for (const output of Object.values(outputs)) output.dispose(); }
      } finally { tensor.dispose(); busy = false; }
    },
    async close() {
      if (busy) throw new Error('Cannot close an active denoise');
      if (!closed) { closed = true; await session.release(); }
    },
  };
}

/**
 * NAFNet's TrueDetail candidate for developed RGB16, through the shared tile runner (same halo, strength and subject protection as
 * TrueDetail). Returns null when the pack is not ready, so the caller keeps the conventional result.
 */
export async function denoiseWithNafnet(source: Uint16Array, width: number, height: number, options: TrueDetailOptions): Promise<Uint16Array | null> {
  const nafnet = await openNafnet();
  if (!nafnet) return null;
  try { return await runTrueDetailTiles(source, width, height, nafnet.infer, options); } finally { await nafnet.close(); }
}
