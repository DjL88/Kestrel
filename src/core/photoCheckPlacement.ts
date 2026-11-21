/** Preserve the photographed subject's proportions before 512px VLM inference. */
export interface PhotoCheckPlacement { x: number; y: number; width: number; height: number }
export function placePhotoInsideSquare(width: number, height: number, edge: number): PhotoCheckPlacement {
  if (![width, height, edge].every(Number.isFinite) || width <= 0 || height <= 0 || edge <= 0)
    throw new RangeError('A photo check needs valid image dimensions.');
  const scale = Math.min(edge / width, edge / height);
  const renderedWidth = width * scale, renderedHeight = height * scale;
  return { x: (edge - renderedWidth) / 2, y: (edge - renderedHeight) / 2,
    width: renderedWidth, height: renderedHeight };
}
