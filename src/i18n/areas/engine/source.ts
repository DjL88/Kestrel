/**
 * Words the V2 engine connection says about a photo: Co-pilot and Auto-pilot results, the deep vision review, denoise
 * results, and the Info panel's fallbacks. British English source. Owner decision 10: whatever a model or assistant
 * produces reaches the screen in the person's language, in plain words, and "unknown" stays unknown in every language.
 */
export const source = {
  /** Slider names in Co-pilot's steps, so each step points at a slider the person can find in Adjust. */
  steps: {
    whiteBalance: 'White balance', temperature: 'Temperature', tint: 'Tint', exposure: 'Exposure', contrast: 'Contrast',
    highlights: 'Highlights', shadows: 'Shadows', whites: 'Whites', blacks: 'Blacks', toneCurve: 'Tone curve',
    vibrance: 'Vibrance', saturation: 'Saturation', colourMixer: 'Colour mixer', clarity: 'Clarity', detailRecovery: 'Texture',
    sharpen: 'Sharpen', denoiseLuminance: 'Luminance noise', denoiseColour: 'Colour noise', upscaleFactor: 'Upscale',
    masks: 'Local adjustments',
  },
  notMeasured: 'Not measured',
  notRecorded: 'Not recorded',
  /** A subject name the app suggested itself, not one the person chose. */
  suggestedName: (name: string) => `${name} (suggested)`,
  /** What kind of subject a photo shows, when no species is named. */
  subjectKinds: { wildlife: 'Wildlife', people: 'People', landscape: 'Landscape', other: 'Other subject' },

  /** Auto-pilot and Co-pilot results. */
  auto: {
    ready: 'Checked edit suggestions are ready to preview.',
    noneDifferent: 'No visibly different edit passed the checks.',
    appliedGentler: 'Auto applied a gentler version: the full one failed a safety check.',
    applied: 'Auto applied. Drag the strength to taste, or undo it.',
    looksGood: 'Looks good: the measured values are in range, so nothing was changed.',
    cannotImprove: 'Cannot improve this safely, so nothing was changed.',
    withheld: 'A suggested edit was held back because it failed a check.',
    multipleSubjects: 'Each subject was checked on its own for lost highlights and shadows. Species colour correction was held back.',
    coverageUnavailable: 'Not every subject could be outlined, so only whole-photo suggestions were considered.',
    speciesReference: (features: string) => `Species reference (a guide, not a measured colour): ${features}`,
  },

  /** The deep vision review notice. */
  deepReview: {
    none: 'Deep review: no subject the detector trusts was found in this photo.',
    confidence: { high: 'high', medium: 'medium', low: 'low' },
    sharpness: { subjectSharp: 'sharp', subjectOk: 'reasonably sharp', subjectSoft: 'soft', noSubject: 'unclear', unavailable: 'unclear' },
    trusted: (confidence: string, sharpness: string) => `Deep review: found a ${confidence}-confidence, ${sharpness} subject.`,
    untrusted: (sharpness: string) => `Deep review: found a subject too ${sharpness} to trust.`,
    witness: { bird: 'bird', aircraft: 'aircraft', person: 'person', animal: 'animal', vehicle: 'vehicle' },
    agreed: (subject: string) => `The scene reading confirmed it as a ${subject}.`,
    conflict: (reading: string, detector: string) => `The scene reading disagrees: it says ${reading}, the detector says ${detector}. Treat this as unresolved.`,
    suggested: (name: string, description: string) => `Suggested: "${name}" - ${description}`,
  },

  /** Denoise results, shown after "Denoise this photo". */
  denoise: {
    noVisibleNoise: 'No visible noise was found at full size, so nothing was changed.',
    protectionLost: 'The subject could not be protected safely this time. Your existing edits were kept.',
    cloud: 'Denoised in the InFlight cloud from a working-size copy, and checked on this device.',
    cloudNotUsed: 'The cloud was not used for this one, so it ran on this device.',
    device: 'Denoised on this device.',
    layersFull: 'Each subject could not have its own layer, so one combined protection layer was used.',
    protected: (count: number) => (count === 1
      ? 'Denoised on this device, with the subject protected.'
      : `Denoised on this device, with ${count} subjects protected together.`),
    global: 'No subject outline was reliable, so denoise was applied evenly to the whole photo.',
    failedCheck: 'The result did not pass the quality check. Your existing edits were kept.',
    leftAsItWas: (notes: string) => `Left as it was. ${notes}`,
  },
};
