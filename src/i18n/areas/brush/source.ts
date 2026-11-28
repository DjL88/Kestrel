import { plural } from '../../../core/locale';

/**
 * The mask brush in the V2 editor (Masks › Manual › Brush and Eraser). British English, the source for every translation.
 */
export const source = {
  paint: "Paint",
  erase: "Erase",
  mode: "Brush mode",
  size: "Brush size",
  stop: "Stop painting",
  layer: (name: string) => `Brush on ${name}`,
  help: "Drag on the photo to paint. Hold Alt to erase for a moment. Press [ or ] to change the size. With the keyboard, the arrow keys move the brush and Space paints.",
  painting: (name: string) => `Painting on ${name}. Its adjustments apply where you paint.`,
  erasing: (name: string) => `Erasing from ${name}. Its adjustments stop where you erase.`,
  added: "Brush mask added. Drag on the photo to paint where its adjustments apply.",
  pickMask: "Open a brush, subject or background mask in the list below, then paint on the photo to add to it or erase from it.",
  refine: "Brush and Eraser also refine a subject or background mask: open it in the list, then paint to add or erase to remove.",
  full: (n: number) => `This mask already has ${n} brush strokes, the most allowed. Add another brush mask to keep painting.`,
  strokes: (n: number) => plural(n, { one: `${n} brush stroke`, other: `${n} brush strokes` }),
  unavailable: "Painting is a preview. Switch on Mask brush in Preview features to use it.",
};
