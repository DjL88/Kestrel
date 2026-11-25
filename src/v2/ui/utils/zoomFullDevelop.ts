/**
 * Whether zooming a RAW should start its full-size develop now.
 *
 * The editor shows a RAW's screen-size develop (long edge at most 2,200 px). Past Fit its pixels soon run out, so a
 * zoomed-in RAW asks for the full-size develop (the same one Develop full size makes) rather than silently magnifying
 * the screen-size copy. Asked once per photo: a develop that failed or was cancelled is not retried by zooming again;
 * the Develop full size button stays offered for that.
 */
export function shouldDevelopOnZoom(photo: { id: string; fullDevelop?: 'offered' | 'running' }, canvasZoom: number, asked: Set<string>): boolean {
  if (photo.fullDevelop !== 'offered' || !(canvasZoom > 1.001) || asked.has(photo.id)) return false;
  asked.add(photo.id);
  return true;
}
