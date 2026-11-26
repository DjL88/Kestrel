import { plural } from '../../../core/locale';

/**
 * Focus stacking in the V2 editor (src/core/focusStack.ts). British English, the source for every translation.
 */
export const source = {
  menu: (n: number) => `Focus stack ${n} photos`,
  menuHint: "Blends the sharpest parts of each photo into a new photo. The originals are not changed.",
  task: (n: number) => `Focus stacking ${n} photos`,
  reading: "Reading the photos",
  aligning: "Lining the photos up",
  blending: "Blending the sharpest parts",
  saving: "Adding the stacked photo",
  done: (name: string, n: number) => `Added ${name}, stacked from ${n} photos. Your original photos are untouched.`,
  cancelled: "Focus stacking stopped. Nothing was added, and your original photos are untouched.",
  failed: "Focus stacking did not finish. Open Tasks for the reason. Your original photos are untouched.",
  tooFew: "Choose at least two photos of the same scene to focus stack. Your original photos are untouched.",
  tooMany: (max: number) => `Choose up to ${max} photos to focus stack at once. Your original photos are untouched.`,
  sizeMismatch: "These photos are different sizes, so they cannot be lined up. Your original photos are untouched.",
  unrelated: (n: number) => `Photo ${n} does not look like the same scene as its neighbour, so nothing was stacked. Choose frames from one burst. Your original photos are untouched.`,
  ambiguous: (n: number) => `It is not clear how photo ${n} lines up with its neighbour. The pattern repeats, or it moved too much, so nothing was stacked rather than guessing. Your original photos are untouched.`,
  tooFlat: (n: number) => `Photo ${n} has too little detail to line up, so nothing was stacked rather than guessing. Your original photos are untouched.`,
  unsupported: (name: string) => `${name} cannot be read at full size here, so nothing was stacked. No smaller picture was used instead. Your original photos are untouched.`,
  rawNotDeveloped: (name: string) => `${name} has no full-size develop from its sensor data yet, and the camera's small embedded preview is not used for stacking. Make the full-size develop first. Your original photos are untouched.`,
  tooLarge: "These photos are too large to stack safely on this device. Nothing was stacked. Your original photos are untouched.",
  equallySharp: "These photos look equally sharp everywhere, so the stack may look much like the originals.",
  frameUnused: (n: number) => `Photo ${n} added almost nothing to the stack.`,
  oneFrameDominates: "One photo supplied almost all of the detail. Check that the photos were taken at different focus distances.",
  localFallback: (n: number) => `Photo ${n} was lined up as a whole only: it had too little matching detail for finer alignment.`,
  mainThread: "It could not run in the background here, so the app may have paused while it worked.",
  infoTitle: "Focus stack",
  infoMadeFrom: (n: number) => plural(n, { one: `Made from ${n} photo:`, other: `Made from ${n} photos:` }),
  infoHow: "Each part comes from the sharpest photo there, blended softly. No pixels were generated.",
};
