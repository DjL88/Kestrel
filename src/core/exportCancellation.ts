/** One cancellation boundary shared by the export loop and its final commit. */
export function exportMayContinue(signalAborted: boolean, taskCancelled: boolean, dialogClosed: boolean): boolean {
  return !signalAborted && !taskCancelled && !dialogClosed;
}
