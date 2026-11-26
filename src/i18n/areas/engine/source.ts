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
    mainThread: 'This device could not denoise in the background, so InFlight may have paused while it worked.',
    learnedLostDetail: 'At full size the AI denoise smoothed away real detail on the subject, so the built-in denoise was used instead.',
    leftAsItWas: (notes: string) => `Left as it was. ${notes}`,
  },
  /** Notices and task names from the V2 workspace's main jobs: open, import, cull, export, masks, denoise, checks. */
  workspace: {
    templateNotSaved: 'InFlight could not save the template on this device.',
    projectNotSaved: 'InFlight could not save this project. Your original photos are unchanged.',
    projectSaveRetrying: 'InFlight could not save this project. It keeps trying; leave InFlight open until it says saved. Your original photos are unchanged.',
    projectSavedAfterRetry: 'Saved. Nothing was lost.',
    projectNotOpened: 'That project could not be opened.',
    /** Desktop Reconnect: find moved or unplugged originals in a folder or drive, proved by their contents. */
    relink: {
      chooseFolder: 'Choose the folder or drive that holds the original photos',
      nothingMissing: 'Every original in this project is connected. Nothing was changed.',
      checking: (count: number) => (count === 1
        ? 'Checking 1 original against the files in that folder…'
        : `Checking ${count} originals against the files in that folder…`),
      reconnected: (count: number) => (count === 1
        ? 'Reconnected 1 photo. Its contents match the original exactly.'
        : `Reconnected ${count} photos. Their contents match the originals exactly.`),
      stillMissing: (count: number) => (count === 1 ? '1 more still needs reconnecting.' : `${count} more still need reconnecting.`),
      noMatch: 'No file in that folder matches a missing original, so nothing was linked. A file that only shares the name is never used.',
      ambiguous: (count: number) => (count === 1
        ? '1 photo has more than one identical file in that folder, so it was left for you to choose a narrower folder.'
        : `${count} photos have more than one identical file in that folder, so they were left for you to choose a narrower folder.`),
      unverifiable: (count: number) => (count === 1
        ? '1 older photo has no recorded fingerprint, so it cannot be reconnected safely. Import it again as a new photo.'
        : `${count} older photos have no recorded fingerprint, so they cannot be reconnected safely. Import them again as new photos.`),
      scanLimit: 'That folder is too large to search completely. Choose a folder closer to the photos.',
      unreadable: 'InFlight could not read that folder. Nothing was changed.',
    },
    thumbnailsTask: (count: number) => (count === 1 ? 'Preparing 1 thumbnail' : `Preparing ${count} thumbnails`),
    thumbnailStage: 'Reading and scaling this photo',
    thumbnailFailed: (filename: string) => `Could not make the thumbnail for ${filename}. Reconnect the original and try again.`,
    rawJpegXl: 'This RAW uses JPEG XL compression, which InFlight can’t read yet. The original is untouched.',
    notConnected: (names: string) => `Not connected to the InFlight engine yet, so not applied: ${names}.`,
    exportRunning: 'An export is already running.',
    selectOneRaw: 'Select one RAW photo to export its TIFF.',
    selectOneRawPng: 'Select one RAW photo to export its PNG.',
    rawTiffTask: 'Preparing 16-bit RAW TIFF',
    rawPngTask: 'Preparing 16-bit RAW PNG',
    rawTiffDevelop: 'Developing the RAW sensor data to 16-bit',
    rawTiffSave: 'Saving the TIFF master',
    rawPngSave: 'Saving the PNG master',
    saveCancelled: 'Save cancelled.',
    rawTiffSaved: 'Saved the 16-bit RAW TIFF. Your original is unchanged.',
    rawPngSaved: 'Saved the 16-bit RAW PNG. Your original is unchanged.',
    rawTiffFailed: 'RAW TIFF export failed. Open Tasks to see why.',
    rawPngFailed: 'RAW PNG export failed. Open Tasks to see why.',
    rawTiffCancelled: 'RAW TIFF export cancelled.',
    rawPngCancelled: 'RAW PNG export cancelled.',
    rawTiffNotQueued: 'Could not start a 16-bit RAW TIFF.',
    rawPngNotQueued: 'Could not start a 16-bit RAW PNG.',
    noFolder: 'No folder was selected. Nothing was exported.',
    exportQueued: (count: number) => (count === 1
      ? 'Queued 1 export. You can keep editing; open Tasks to pause, prioritise or cancel.'
      : `Queued ${count} exports. You can keep editing; open Tasks to pause, prioritise or cancel.`),
    exportDone: (count: number) => (count === 1
      ? 'Exported 1 file. Your originals are unchanged.'
      : `Exported ${count} files. Your originals are unchanged.`),
    exportSomeFailed: 'Some exports failed. Open Tasks and choose Retry failed. Files already saved stay in place.',
    exportStopped: 'Export stopped. Files already saved stay in place.',
    enlargementTask: 'Making the enlargement preview',
    exportNotQueued: 'Could not start this export.',
    destinationUnavailable: 'That export destination is unavailable. Choose a local ZIP, separate files or a desktop folder.',
    cullPro: 'Auto pick is part of InFlight Pro.',
    cullOffer: "Photos added. Press Auto pick to sort them on this device; nothing is flagged until you do.",
    cullSwitchedOff: "Auto pick is switched off for this account, so it did not run. Your photos are unchanged.",
    cullRunning: 'Auto pick is already running.',
    cullNothing: 'Every photo already has a decision, so there is nothing to cull.',
    cullTask: 'Auto pick and analyse',
    cullScan: 'Scanning the photos and comparing across the shoot',
    cullNoDetector: 'The subject detector is unavailable. Auto pick used sharpness and exposure only, so it is less certain.',
    cullDetectorStage: 'Subject detection unavailable; please review',
    cullApply: 'Applying suggestions without changing your own flags',
    cullFailed: 'Auto pick failed. No new decisions were applied. Open Tasks for details.',
    cullNotQueued: 'Auto pick could not start.',
    formatFirst: 'Choose an existing photo format before splitting it.',
    formatRejoined: 'Format rejoined into one frame.',
    formatSplit: (count: number) => `This format will export as ${count} frames in a row.`,
    skyUnavailable: 'Sky detection is unavailable. Add a manual Gradient instead.',
    brushUnavailable: 'Brush painting is not connected to the canvas yet. Use an adjustable Oval or Gradient.',
    masksFull: 'This photo has the most masks it can hold. Remove one first.',
    tapNothingSelected: 'Nothing was selected at that point. Tap inside the subject.',
    tapNotAnswered: 'That tap could not be answered. Nothing was changed.',
    ovalAdded: 'Added an adjustable Oval area mask. Open its layer to place it, then move a slider to change the photo. You can undo this.',
    gradientAdded: 'Added an adjustable Gradient mask. Open its layer to place it, then move a slider to change the photo. You can undo this.',
    findSubjectTask: 'Finding the subject',
    findBackgroundTask: 'Finding the background',
    findEdgesStage: 'Finding the subject’s edges on this device',
    maskDiscarded: 'The mask was not kept because the photo changed or its layers are full. Try finding the subject again.',
    saveMaskStage: 'Saving a mask you can undo',
    subjectMaskAdded: (confidence: string) => (confidence
      ? `Added the subject mask (${confidence} confidence). It changes nothing until you move one of its sliders.`
      : 'Added the subject mask. It changes nothing until you move one of its sliders.'),
    backgroundMaskAdded: (confidence: string) => (confidence
      ? `Added the background mask (${confidence} confidence). It changes nothing until you move one of its sliders.`
      : 'Added the background mask. It changes nothing until you move one of its sliders.'),
    confidence: { high: 'high', medium: 'medium', low: 'low' },
    subjectFailed: 'Subject detection failed. Open Tasks for details.',
    subjectNotQueued: 'Could not start subject detection.',
    denoiseTask: (filename: string) => `Denoising ${filename}`,
    denoiseStage: 'Denoising and checking detail',
    denoiseNoSource: 'Denoise could not read the original photo.',
    denoisePhotoChanged: 'The photo changed, so no denoise result was applied. Run denoise again.',
    denoiseApplyStage: 'Applying checked adjustments you can undo',
    denoiseFailed: 'Denoise did not finish. Open Tasks to see why.',
    denoiseNotQueued: 'Denoise could not start.',
    suggestionStale: 'The photo changed after this suggestion was made. Wait for a fresh check.',
    checkTask: (filename: string) => `Checking ${filename} and its colour`,
    checkStage: 'Looking at exposure, colour and scene',
    secondOpinionStage: "Second opinion from the on-device vision model",
    checkFailed: 'Could not check this photo. Open Tasks for details.',
    deepTask: 'Running a deep vision review',
    deepStage: 'Looking at the subjects and photo quality',
    deepNoResult: 'The deep vision review gave no usable result.',
    deepFailed: 'Deep vision review failed. Open Tasks for details.',
    deepNotQueued: 'Could not start the deep vision review.',
    importRunning: 'Photos are already being added. Wait for them to finish, or stop that task first.',
    importNothingNew: 'Those photos are already in this project.',
    importTask: (count: number) => (count === 1 ? 'Adding 1 photo' : `Adding ${count} photos`),
    folderLooking: (folder: string) => `Looking through ${folder} for photos…`,
    folderLookingProgress: (folder: string, done: number, total: number) => `Looking through ${folder}: ${done} of ${total} photos`,
    importReadStage: 'Reading the original and recording its fingerprint',
    importOneFailed: (filename: string) => `Could not import ${filename}. Check the original and try again.`,
    importUnreadable: (names: string) => `Could not read ${names}.`,
    importSaveStage: 'Saving the photo in this project',
    importSomeFailed: (added: number) => `Some photos could not be imported. ${added} were added. Open Tasks to retry only the ones that failed.`,
    importStopped: (added: number) => `Import stopped. ${added} photos were added. Your originals are unchanged.`,
    importNotFinished: (count: number, names: string) => `The last import into this project did not finish: ${count} photos were not added (${names}). Import them again to add them. Photos already added are kept.`,
    importFailed: 'Adding photos failed. Your originals were not changed.',
  },
};
