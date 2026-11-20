/** Export proof navigation. Never silently preview an output that is not selected. */
export type ProofChoice = Readonly<{ photoId: string; destinationId: string }>;
export function reconcileProofChoice(
  previous: ProofChoice | null,
  photoIds: readonly string[],
  destinationIds: readonly string[],
): ProofChoice | null {
  const photos = photoIds.filter(Boolean);
  const destinations = destinationIds.filter(Boolean);
  if (!photos.length || !destinations.length) return null;
  return Object.freeze({
    photoId: previous && photos.includes(previous.photoId) ? previous.photoId : photos[0],
    destinationId: previous && destinations.includes(previous.destinationId) ? previous.destinationId : destinations[0],
  });
}
export function chooseProof(
  current: ProofChoice | null,
  selection: Partial<ProofChoice>,
  photoIds: readonly string[],
  destinationIds: readonly string[],
): ProofChoice | null {
  const next = reconcileProofChoice(current, photoIds, destinationIds);
  if (!next) return null;
  if (selection.photoId !== undefined && !photoIds.includes(selection.photoId)) throw new Error('Photo is not in the export selection.');
  if (selection.destinationId !== undefined && !destinationIds.includes(selection.destinationId)) throw new Error('Destination is not selected for export.');
  return Object.freeze({ photoId: selection.photoId ?? next.photoId, destinationId: selection.destinationId ?? next.destinationId });
}
