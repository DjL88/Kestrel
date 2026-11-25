/**
 * Focus stacking off the interface thread. A thin adapter: every message is handled by `runFocusStackRequest`
 * (focusStackOffThread.ts), which the unit tests run directly. Started by `focusStackOffThread.ts`.
 */
import { runFocusStackRequest, type FocusStackRequest } from './focusStackOffThread';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FocusStackRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  void runFocusStackRequest(event.data, (message, transfer) => scope.postMessage(message, transfer ?? []));
};
