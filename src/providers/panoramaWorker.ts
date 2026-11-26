/**
 * Panorama stitching off the interface thread. A thin adapter: every message is handled by `runPanoramaRequest`
 * (panoramaOffThread.ts), which the unit tests run directly. Started by `panoramaOffThread.ts`.
 */
import { runPanoramaRequest, type PanoramaRequest } from './panoramaOffThread';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PanoramaRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  void runPanoramaRequest(event.data, (message, transfer) => scope.postMessage(message, transfer ?? []));
};
