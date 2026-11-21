/** Only a current pointer gesture uses its local thumb value. Outside it the
 * authoritative edit immediately wins, even for Undo/photo/history changes. */
export function liveSliderValue(committed: number, draft: number, pointerActive: boolean): number {
  return pointerActive && Number.isFinite(draft) ? draft : committed;
}
