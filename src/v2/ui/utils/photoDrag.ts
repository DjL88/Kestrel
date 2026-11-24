/** The drag type the filmstrip uses for photographs: a JSON array of photo ids. */
export const PHOTO_DRAG_TYPE = 'application/x-inflight-photos';

/** The photographs a drag carries: the whole selection when the dragged photo is part of it, otherwise that photo. */
export function draggedPhotoIds(photoId: string, selected: readonly string[]): string[] {
  return selected.includes(photoId) ? [photoId, ...selected.filter((id) => id !== photoId)] : [photoId];
}

/** Read photo ids from a drop, ignoring anything malformed. */
export function readPhotoDrag(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length < 200).slice(0, 100) : [];
  } catch { return []; }
}
