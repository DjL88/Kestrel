/**
 * Denoise's pixel work, off the interface thread. A thin adapter: every message is handled by
 * `handleDenoiseWorkerMessage` (v2/engineClient/denoiseCompute.ts), which the unit tests run directly.
 * Started by `denoiseOffThread.ts`.
 */
import { createDenoiseWorkerState, handleDenoiseWorkerMessage, type DenoiseWorkerRequest } from '../v2/engineClient/denoiseCompute';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<DenoiseWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

const state = createDenoiseWorkerState();

scope.onmessage = (event) => {
  const { reply, transfer } = handleDenoiseWorkerMessage(state, event.data);
  scope.postMessage(reply, transfer);
};
