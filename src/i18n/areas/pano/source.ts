import { plural } from '../../../core/locale';

/**
 * Panorama stitching in the V2 editor (src/core/panorama.ts). British English, the source for every translation.
 */
export const source = {
  menu: (n: number) => `Stitch ${n} photos into a panorama`,
  menuHint: "Joins overlapping photos into one new wide photo, cropped to real pixels only. The originals are not changed.",
  task: (n: number) => `Stitching a panorama from ${n} photos`,
  reading: "Reading the photos",
  matching: "Finding where the photos overlap",
  placing: "Placing the photos",
  blending: "Blending the seams",
  saving: "Adding the panorama",
  done: (name: string, n: number) => `Added ${name}, stitched from ${n} photos. Your original photos are untouched.`,
  cropNote: (percent: number) => `Cropped to the ${percent}% of the stitched area that real pixels cover. Nothing was filled in.`,
  cancelled: "Panorama stitching stopped. Nothing was added, and your original photos are untouched.",
  failed: "The panorama did not finish. Open Tasks for the reason. Your original photos are untouched.",
  tooFew: "Choose at least two overlapping photos to stitch. Your original photos are untouched.",
  tooMany: (max: number) => `Choose up to ${max} photos to stitch at once. Your original photos are untouched.`,
  sizeMismatch: "These photos are different sizes, so they were not stitched. Your original photos are untouched.",
  tooFlat: (n: number) => `Photo ${n} has too little detail to line up, so nothing was stitched rather than guessing. Your original photos are untouched.`,
  unrelated: (n: number) => `Photo ${n} does not overlap the photo before it enough to line them up, so nothing was stitched. Choose photos in the order you took them, each overlapping the next by about a third. Your original photos are untouched.`,
  ambiguous: (n: number) => `It is not clear where photo ${n} joins the photo before it. The pattern repeats, or the camera tilted too much, so nothing was stitched rather than guessing. Your original photos are untouched.`,
  vertical: "These photos run up and down rather than side to side. Vertical panoramas are not supported yet, so nothing was stitched. Your original photos are untouched.",
  tooLarge: "This panorama would be too large to make safely on this device, and it is not made smaller without asking. Choose fewer photos. Your original photos are untouched.",
  noCoverage: "The photos do not leave a rectangle covered by real pixels, so nothing was stitched rather than filling gaps. Your original photos are untouched.",
  unsupported: (name: string) => `${name} cannot be read at full size here, so nothing was stitched. No smaller picture was used instead. Your original photos are untouched.`,
  rawNotDeveloped: (name: string) => `${name} has no full-size develop from its sensor data yet, and the camera's small embedded preview is not used for panoramas. Make the full-size develop first. Your original photos are untouched.`,
  exposureDiffers: "The photos were taken at quite different brightness. They were evened out, but check the sky for bands.",
  seamsVisible: "Some seams may show: something moved between photos, or the camera moved rather than turned.",
  focalEstimated: "The lens focal length was not recorded, so it was worked out from the photos.",
  mainThread: "It could not run in the background here, so the app may have paused while it worked.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Stitched from ${n} photo:`, other: `Stitched from ${n} photos:` }),
  infoHow: "Placed on a cylinder, seams blended softly, and cropped to real pixels. No pixels were generated.",
};
