import type { Photo } from '../ui/contract';

/** Mark a RAW photo with the JPEG kept beside it. */
export function withPairedJpeg(pairedJpeg: string | undefined, photo: Photo): Photo {
  return pairedJpeg ? { ...photo, pairedJpeg } : photo;
}

/**
 * Bursts are counted over the photos actually shown. A RAW and its own JPEG share a capture time, so without this
 * a single shot could read as "a burst of 2" once its JPEG is folded into it. Fewer than two shown means no burst.
 */
export function recountBursts(photos: Photo[]): Photo[] {
  const members = new Map<string, Photo[]>();
  for (const photo of photos) if (photo.burst) members.set(photo.burst.groupId, [...(members.get(photo.burst.groupId) ?? []), photo]);
  return photos.map((photo) => {
    if (!photo.burst) return photo;
    const group = members.get(photo.burst.groupId) ?? [];
    if (group.length < 2) {
      const { burst: _dropped, ...rest } = photo;
      return rest;
    }
    if (group.length === photo.burst.count) return photo;
    const ordered = [...group].sort((a, b) => (a.burst!.index - b.burst!.index));
    return { ...photo, burst: { ...photo.burst, count: group.length, index: ordered.indexOf(photo) + 1 } };
  });
}
