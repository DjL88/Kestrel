import { plural } from '../../../core/locale';

/**
 * HDR merge in the V2 editor (src/core/hdrMerge.ts). British English, the source for every translation.
 */
export const source = {
  menu: (n: number) => `Merge ${n} photos to HDR`,
  menuHint: "Combines a bracket of darker and brighter photos into a new 16-bit photo that keeps highlights and shadows. The originals are not changed.",
  task: (n: number) => `Merging ${n} photos to HDR`,
  reading: "Reading the photos",
  aligning: "Lining the photos up",
  merging: "Merging the exposures",
  saving: "Adding the HDR photo",
  done: (name: string, n: number) => `Added ${name}, merged from ${n} photos. Your original photos are untouched.`,
  cancelled: "HDR merge stopped. Nothing was added, and your original photos are untouched.",
  failed: "The HDR merge did not finish. Open Tasks for the reason. Your original photos are untouched.",
  tooFew: "Choose at least two photos of the same scene, shot darker and brighter, to merge to HDR. Your original photos are untouched.",
  tooMany: (max: number) => `Choose up to ${max} photos to merge to HDR at once. Your original photos are untouched.`,
  sizeMismatch: "These photos are different sizes, so they cannot be lined up. Your original photos are untouched.",
  sameExposure: "These photos look like the same exposure, so there is nothing to merge. Choose a bracket shot darker and brighter. Your original photos are untouched.",
  unrelated: (n: number) => `Photo ${n} does not line up with the others clearly enough, so nothing was merged rather than guessing. Choose frames from one bracket. Your original photos are untouched.`,
  unsupported: (name: string) => `${name} cannot be read at full size here, so nothing was merged. No smaller picture was used instead. Your original photos are untouched.`,
  rawNotDeveloped: (name: string) => `${name} could not be developed at 16 bits from its sensor data here, and the camera's small embedded preview is not used for HDR. Reconnect the original and try again. Your original photos are untouched.`,
  tooLarge: "These photos are too large to merge safely on this device. Nothing was merged. Your original photos are untouched.",
  ghostsRemoved: "Something moved between the photos. Where it did, the merge uses one photo only, so nothing appears twice.",
  highlightsClipped: "Some highlights were too bright even in the darkest photo, so they stay white.",
  mainThread: "It could not run in the background here, so the app may have paused while it worked.",
  infoTitle: "HDR merge",
  infoMadeFrom: (n: number) => plural(n, { one: `Made from ${n} photo:`, other: `Made from ${n} photos:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} stops`,
  infoHow: "Each part comes from the photos that were well exposed there, lined up and weighted by exposure, then toned with the editor's Highlights and Shadows. No pixels were generated.",
};
