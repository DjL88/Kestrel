/**
 * HDR merging off the interface thread. A thin adapter: every message is handled by `runHdrMergeRequest`
 * (hdrMergeOffThread.ts), which the unit tests run directly. Started by `hdrMergeOffThread.ts`.
 */
import { runHdrMergeRequest, type HdrMergeRequest } from './hdrMergeOffThread';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HdrMergeRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  void runHdrMergeRequest(event.data, (message, transfer) => scope.postMessage(message, transfer ?? []));
};
