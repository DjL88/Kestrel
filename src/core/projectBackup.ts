import { MAX_EDIT_HISTORY_STEPS, validWhy, type EditKind } from './editHistory';
import { parseSpeciesArea } from './speciesArea';
import { readCollage } from './collage';
import { parseSettings } from './projectSettings';
import { validMasks } from './maskTypes';
import { validHeal } from './heal';
import { readPanoramaRecipe } from './panoramaRecipe';
import { validTrueDetailAi } from './trueDetailAi';
import { validCurve, validMixer } from './curveMixer';
import { validChannelCurves, validGrade } from './colourGrade';
import { validCalibration } from './calibration';
import { validDehaze } from './dehaze';
import { validCaptureSharpen, validDeblur } from './captureSharpen';
import { validDefringe, validLateralCa } from './fringe';
import { validLens } from './lensCorrection';
import { validGrain, validVignette } from './finishing';
import { validAsShot, validWhiteBalance } from './asShotWhite';
import { isRawCodec } from './pictureSource';
import type { CullingState, FilterState, PhotoFrame, ShootDescriptor } from './types';
import { DEVELOP_VERSION } from './backgroundDevelop';
import { withoutLocation } from './photoTags';

const FORMAT = 'kestrel-project';
const decisions = new Set(['unreviewed', 'keep', 'reject']);
const filters = new Set(['all', ...decisions]);
const sources = new Set(['demo', 'file', 'directory-handle']);
const projectSources = new Set(['demo', 'local-files', 'local-folder']);
const demoAssets = new Set(['red-kite', 'kingfisher', 'barn-owl', 'collie-coco', 'red-fox', 'osprey']);
const EXIF_DATE = /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/;
const EXIF_OFFSET = /^[+-]\d{2}:\d{2}$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function number(value: unknown, min = -Infinity, max = Infinity): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function text(value: unknown): value is string {
  return typeof value === 'string';
}

function key(value: unknown): value is string {
  return text(value) && value.length > 0;
}

function oneOf(value: unknown, choices: Set<string>): boolean {
  return text(value) && choices.has(value);
}

function nullableKey(value: unknown): boolean {
  return value === null || key(value);
}

const editKinds = new Set<EditKind>(['light', 'warmth', 'colour', 'adjustments', 'tone', 'detail', 'mask', 'crop', 'rotation', 'straighten']);

function recipeIsValid(value: unknown): boolean {
  if (!record(value)) return false;
  const edit = value.edit;
  if (edit !== undefined && (!record(edit) || !number(edit.exposure, -12.5, 12.5) ||
    !number(edit.warmth, -2, 2) || !number(edit.colour, -2, 2) ||
    ['brightness', 'tint', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'texture', 'clarity', 'sharpen'].some((key) =>
      edit[key] !== undefined && !number(edit[key], -2, 2)) ||
    (edit.denoise !== undefined && !number(edit.denoise, 0, 2)) ||
    (edit.denoiseLuminance !== undefined && !number(edit.denoiseLuminance, 0, 2)) ||
    (edit.trueDetailAi !== undefined && !validTrueDetailAi(edit.trueDetailAi)) ||
    (edit.curve !== undefined && !validCurve(edit.curve)) || (edit.mixer !== undefined && !validMixer(edit.mixer)) ||
    (edit.grade !== undefined && !validGrade(edit.grade)) || (edit.channelCurves !== undefined && !validChannelCurves(edit.channelCurves)) ||
    (edit.calibration !== undefined && !validCalibration(edit.calibration)) ||
    (edit.dehaze !== undefined && !validDehaze(edit.dehaze)) ||
    (edit.captureSharpen !== undefined && !validCaptureSharpen(edit.captureSharpen)) || (edit.deblur !== undefined && !validDeblur(edit.deblur)) ||
    (edit.lens !== undefined && !validLens(edit.lens)) ||
    (edit.lateralCa !== undefined && !validLateralCa(edit.lateralCa)) || (edit.defringe !== undefined && !validDefringe(edit.defringe)) ||
    (edit.vignette !== undefined && !validVignette(edit.vignette)) || (edit.grain !== undefined && !validGrain(edit.grain)) ||
    (edit.whiteBalance !== undefined && !validWhiteBalance(edit.whiteBalance)) ||
    (edit.masks !== undefined && !validMasks(edit.masks)) || (edit.heal !== undefined && !validHeal(edit.heal)))) return false;
  const framing = value.framing;
  if (framing !== undefined && (!record(framing) || (framing.ratio !== null && !number(framing.ratio, 0.01, 100)) ||
    !number(framing.turns, 0, 3) || !Number.isInteger(framing.turns) || !number(framing.straighten, -12, 12) ||
    !number(framing.x, 0, 1) || !number(framing.y, 0, 1) || (framing.size !== undefined && !number(framing.size, 0.05, 1)))) return false;
  return true;
}

function historyIsValid(value: unknown): boolean {
  if (!record(value) || !Array.isArray(value.steps) || value.steps.length > MAX_EDIT_HISTORY_STEPS ||
    !number(value.cursor, 0, value.steps.length) || !Number.isInteger(value.cursor)) return false;
  return value.steps.every((step: unknown) => record(step) && text(step.kind) && editKinds.has(step.kind as EditKind) &&
    number(step.at, 0) && recipeIsValid(step.before) && recipeIsValid(step.after) && (step.why === undefined || validWhy(step.why)));
}

function frameIsValid(value: unknown): value is PhotoFrame {
  if (!record(value) || !key(value.id) || !key(value.stableKey) || !key(value.filename) ||
    !number(value.sequenceIndex, 0) || !Number.isSafeInteger(value.sequenceIndex) ||
    !oneOf(value.decision, decisions) || !oneOf(value.sourceKind, sources) ||
    !nullableKey(value.burstGroupId) || !number(value.burstIndex, 0) || !Number.isSafeInteger(value.burstIndex) ||
    !number(value.burstCount, 0) || !Number.isSafeInteger(value.burstCount) ||
    typeof value.isDemo !== 'boolean' || !record(value.exif)) return false;
  // A damaged fingerprint must never be promoted into a trusted restored original.
  // Older projects may legitimately have no fingerprint and must be reverified on reconnect.
  if (value.originalSha256 !== undefined &&
      (typeof value.originalSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.originalSha256))) return false;
  if (value.rating !== undefined && (!number(value.rating, 0, 5) || !Number.isInteger(value.rating))) return false;
  if (value.removedAt !== undefined && !number(value.removedAt, 0)) return false;
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 24 || !value.tags.every(text))) return false;
  if (value.speciesChecked !== undefined && typeof value.speciesChecked !== 'boolean') return false;
  if (value.speciesArea !== undefined && !parseSpeciesArea(value.speciesArea)) return false;
  if (value.subjectDisputed !== undefined && typeof value.subjectDisputed !== 'boolean') return false;
  if (value.cullConfidence !== undefined && !['high', 'medium', 'low'].includes(value.cullConfidence as string)) return false;
  if (value.cullScore !== undefined && !number(value.cullScore, 0, 100)) return false;
  if (value.asShotWhite !== undefined && !validAsShot(value.asShotWhite)) return false;
  if (value.rawCodec !== undefined && !isRawCodec(value.rawCodec)) return false;
  for (const field of ['autoTags', 'declinedTags']) {
    if (value[field] !== undefined && (!Array.isArray(value[field]) || (value[field] as unknown[]).length > 48 || !(value[field] as unknown[]).every(text))) return false;
  }
  if (value.subjectKind !== undefined && !['wildlife', 'people', 'landscape', 'other'].includes(value.subjectKind as string)) return false;
  if (value.subjectNames !== undefined && (!Array.isArray(value.subjectNames) || !value.subjectNames.every(text))) return false;
  for (const field of ['camera', 'lens', 'shutterSpeed', 'formatLabel']) {
    if (value.exif[field] !== undefined && !text(value.exif[field])) return false;
  }
  for (const field of ['rating', 'focalLengthMm', 'apertureF', 'iso', 'capturedAtMs', 'width', 'height']) {
    if (value.exif[field] !== undefined && !number(value.exif[field])) return false;
  }
  const stamp = value.exif.captureStamp;
  if (stamp !== undefined) {
    if (!record(stamp)) return false;
    for (const [field, shape] of [['original', EXIF_DATE], ['digitized', EXIF_DATE], ['offsetOriginal', EXIF_OFFSET], ['offsetDigitized', EXIF_OFFSET]] as const) {
      if (stamp[field] !== undefined && (typeof stamp[field] !== 'string' || !shape.test(stamp[field] as string))) return false;
    }
  }
  if (!recipeIsValid(value) || (value.editHistory !== undefined && !historyIsValid(value.editHistory))) return false;
  const focus = value.focusPoint;
  if (focus !== undefined && (!record(focus) || !number(focus.x, 0, 1) || !number(focus.y, 0, 1))) return false;
  if (value.panorama !== undefined && !readPanoramaRecipe(value.panorama)) return false;
  const copy = value.virtualCopy;
  if (copy !== undefined && (!record(copy) || !key(copy.originalFrameId) || !number(copy.number, 1))) return false;
  if (!value.isDemo) return value.sourceKind !== 'demo' && value.demoVariant === undefined;
  const demo = value.demoVariant;
  return value.sourceKind === 'demo' && record(demo) && oneOf(demo.assetKey, demoAssets) &&
    text(demo.demoSceneLabel) && number(demo.panX) && number(demo.panY) &&
    number(demo.cropScale, 0.5, 2) && number(demo.softnessPx, 0, 10);
}

function descriptorIsValid(value: unknown): value is ShootDescriptor {
  return record(value) && key(value.title) && oneOf(value.sourceKind, projectSources) &&
    number(value.createdAt, 0) && (value.folderName === undefined || text(value.folderName));
}

export function encodeProjectBackup(state: CullingState): string {
  return JSON.stringify({
    format: FORMAT,
    version: 1,
    // Cached RAW review pictures remain on their original device. They are
    // versioned and rebuilt if needed; never claim a cache is a RAW master.
    cache: { developVersion: DEVELOP_VERSION, reviewPreviews: 'device-local', imagesIncluded: false },
    project: {
      // Derived OCR can contain private writing or registration numbers. It stays
      // on this device; portable or cloud backups regenerate it rather than
      // copying unconfirmed text to another destination. Location (GPS, place tags) is personal and stays too.
      shoot: state.shoot, frames: state.frames.map(({ searchEvidence: _local, ...frame }) => withoutLocation(frame)), selectedFrameId: state.selectedFrameId,
      compareRightFrameId: state.compareRightFrameId, filter: state.filter, searchQuery: state.searchQuery,
      keeperTarget: state.keeperTarget, autoAdvance: state.autoAdvance,
      ...(state.settings ? { settings: state.settings } : {}),
    },
  });
}

export function restoreProjectBackup(contents: string, id: string, now = Date.now()): CullingState {
  let envelope: unknown;
  try { envelope = JSON.parse(contents); } catch { throw new Error('This file is not a readable InFlight project backup.'); }
  if (!record(envelope) || envelope.format !== FORMAT || envelope.version !== 1 || !record(envelope.project)) {
    throw new Error('This file is not a supported InFlight project backup.');
  }
  const { shoot, frames, selectedFrameId, compareRightFrameId, filter, searchQuery, keeperTarget, autoAdvance } = envelope.project;
  if (!descriptorIsValid(shoot) || !Array.isArray(frames) || !frames.every(frameIsValid) ||
    !oneOf(filter, filters) || !text(searchQuery) || !number(keeperTarget, 1, 9999) ||
    !Number.isSafeInteger(keeperTarget) || typeof autoAdvance !== 'boolean') {
    throw new Error('The project backup has missing or invalid catalogue data.');
  }
  // A stableKey denotes one original source. A damaged or hand-edited backup
  // must not let two records with that key claim different original bytes,
  // even when neither record is a virtual copy. Unknown legacy hashes are
  // not evidence of equality and must be verified again when relinking.
  const hashesByStableKey = new Map<string, string>();
  for (const frame of frames as PhotoFrame[]) {
    if (!frame.originalSha256) continue;
    const prior = hashesByStableKey.get(frame.stableKey);
    if (prior && prior !== frame.originalSha256) {
      throw new Error('The project backup contains conflicting original byte identities.');
    }
    hashesByStableKey.set(frame.stableKey, frame.originalSha256);
  }
  const ids = new Map(frames.map((frame) => [frame.id, frame]));
  if (ids.size !== frames.length || frames.some((frame) => {
    if (!frame.virtualCopy) return false;
    const original = ids.get(frame.virtualCopy.originalFrameId);
    return !original || original.virtualCopy || original.stableKey !== frame.stableKey ||
      // A copied edit must not silently become associated with different original bytes.
      // Legacy records missing a fingerprint remain disconnected until independently reverified.
      (typeof original.originalSha256 === 'string' && typeof frame.originalSha256 === 'string' &&
        original.originalSha256 !== frame.originalSha256);
  })) throw new Error('The project backup contains invalid photo links.');
  const collage = shoot.collage === undefined ? undefined : readCollage(shoot.collage);
  if (shoot.collage !== undefined && (!collage || collage.pages.some(page => page.slots.some(slot => slot.photoId !== null && !ids.has(slot.photoId))))) {
    throw new Error('The project backup contains invalid collage layout or photo links.');
  }
  const existingId = (value: unknown) => text(value) && ids.has(value) && ids.get(value)?.removedAt == null ? value : null;
  return {
    shoot: {
      id, title: `${shoot.title} (restored)`, sourceKind: shoot.sourceKind,
      ...(collage ? { collage } : {}),
      folderName: shoot.folderName, totalFrames: frames.length, createdAt: shoot.createdAt, lastUpdatedAt: now,
      needsFolderRegrant: frames.some((frame) => frame.sourceKind === 'directory-handle'),
      needsFileReselect: frames.some((frame) => frame.sourceKind === 'file'),
    },
    // Portable backups cannot silently carry automatic OCR of personal writing.
    frames: (frames as PhotoFrame[]).map(({ searchEvidence: _local, ...frame }) => withoutLocation(frame)),
    filter: filter as FilterState, searchQuery, keeperTarget, autoAdvance,
    ...(record(envelope.project.settings) ? { settings: parseSettings(envelope.project.settings) } : {}),
    selectedFrameId: existingId(selectedFrameId),
    compareRightFrameId: existingId(compareRightFrameId),
    undoStack: [], redoStack: [],
  };
}
