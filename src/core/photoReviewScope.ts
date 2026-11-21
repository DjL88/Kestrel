/**
 * An asynchronous photographic opinion belongs to exactly the photo, framing,
 * edit recipe and provider that initiated it. Every caller must supply stable
 * identity tokens for each of those dimensions; never compare only filenames.
 *
 * Referential identity is intentional: a newly edited recipe must invalidate
 * even when two objects have accidentally identical serialised values.
 * This is a cheap synchronous guard, not a cryptographic source-byte proof.
 */
export type PhotoReviewScope = readonly unknown[];

export function samePhotoReviewScope(
  requested: PhotoReviewScope | null,
  current: PhotoReviewScope,
): boolean {
  return requested !== null && requested.length === current.length &&
    requested.every((part, index) => Object.is(part, current[index]));
}

/** Copy an identity tuple before an await. Never retain a mutable input array. */
export function capturePhotoReviewScope(parts: PhotoReviewScope): PhotoReviewScope {
  return Object.freeze([...parts]);
}
