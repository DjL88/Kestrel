import type { CullingState, FilterState, PhotoFrame, ShootDescriptor } from './types';

const FORMAT = 'kestrel-project';
const decisions = new Set(['unreviewed', 'keep', 'reject']);
const filters = new Set(['all', ...decisions]);
const sources = new Set(['demo', 'file', 'directory-handle']);
const projectSources = new Set(['demo', 'local-files', 'local-folder']);
const demoAssets = new Set(['red-kite', 'kingfisher', 'barn-owl', 'collie-coco', 'red-fox', 'osprey']);

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

function frameIsValid(value: unknown): value is PhotoFrame {
  if (!record(value) || !key(value.id) || !key(value.stableKey) || !key(value.filename) ||
    !number(value.sequenceIndex, 0) || !oneOf(value.decision, decisions) || !oneOf(value.sourceKind, sources) ||
    !nullableKey(value.burstGroupId) || !number(value.burstIndex, 0) || !number(value.burstCount, 0) ||
    typeof value.isDemo !== 'boolean' || !record(value.exif)) return false;
  if (value.rating !== undefined && (!number(value.rating, 0, 5) || !Number.isInteger(value.rating))) return false;
  if (value.subjectNames !== undefined && (!Array.isArray(value.subjectNames) || !value.subjectNames.every(text))) return false;
  for (const field of ['camera', 'lens', 'shutterSpeed', 'formatLabel']) {
    if (value.exif[field] !== undefined && !text(value.exif[field])) return false;
  }
  for (const field of ['rating', 'focalLengthMm', 'apertureF', 'iso', 'capturedAtMs', 'width', 'height']) {
    if (value.exif[field] !== undefined && !number(value.exif[field])) return false;
  }
  const edit = value.edit;
  if (edit !== undefined && (!record(edit) || !number(edit.exposure, -2, 2) ||
    !number(edit.warmth, -2, 2) || !number(edit.colour, -2, 2) ||
    ['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'texture', 'clarity', 'sharpen'].some((key) =>
      edit[key] !== undefined && !number(edit[key], -2, 2)))) return false;
  const framing = value.framing;
  if (framing !== undefined && (!record(framing) || (framing.ratio !== null && !number(framing.ratio, 0.01, 100)) ||
    !number(framing.turns, 0, 3) || !Number.isInteger(framing.turns) || !number(framing.straighten, -12, 12) ||
    !number(framing.x, 0, 1) || !number(framing.y, 0, 1))) return false;
  const focus = value.focusPoint;
  if (focus !== undefined && (!record(focus) || !number(focus.x, 0, 1) || !number(focus.y, 0, 1))) return false;
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
    project: {
      shoot: state.shoot, frames: state.frames.map(({ editHistory: _history, ...frame }) => frame), selectedFrameId: state.selectedFrameId,
      compareRightFrameId: state.compareRightFrameId, filter: state.filter, searchQuery: state.searchQuery,
      keeperTarget: state.keeperTarget, autoAdvance: state.autoAdvance,
    },
  });
}

export function restoreProjectBackup(contents: string, id: string, now = Date.now()): CullingState {
  let envelope: unknown;
  try { envelope = JSON.parse(contents); } catch { throw new Error('This file is not a readable Kestrel project backup.'); }
  if (!record(envelope) || envelope.format !== FORMAT || envelope.version !== 1 || !record(envelope.project)) {
    throw new Error('This file is not a supported Kestrel project backup.');
  }
  const { shoot, frames, selectedFrameId, compareRightFrameId, filter, searchQuery, keeperTarget, autoAdvance } = envelope.project;
  if (!descriptorIsValid(shoot) || !Array.isArray(frames) || !frames.every(frameIsValid) ||
    !oneOf(filter, filters) || !text(searchQuery) || !number(keeperTarget, 1, 9999) || typeof autoAdvance !== 'boolean') {
    throw new Error('The project backup has missing or invalid catalogue data.');
  }
  const ids = new Map(frames.map((frame) => [frame.id, frame]));
  if (ids.size !== frames.length || frames.some((frame) => {
    if (!frame.virtualCopy) return false;
    const original = ids.get(frame.virtualCopy.originalFrameId);
    return !original || original.virtualCopy || original.stableKey !== frame.stableKey;
  })) throw new Error('The project backup contains invalid photo links.');
  const existingId = (value: unknown) => text(value) && ids.has(value) ? value : null;
  return {
    shoot: {
      id, title: `${shoot.title} (restored)`, sourceKind: shoot.sourceKind,
      folderName: shoot.folderName, totalFrames: frames.length, createdAt: shoot.createdAt, lastUpdatedAt: now,
      needsFolderRegrant: frames.some((frame) => frame.sourceKind === 'directory-handle'),
      needsFileReselect: frames.some((frame) => frame.sourceKind === 'file'),
    },
    frames: frames.map(({ editHistory: _history, ...frame }) => frame), filter: filter as FilterState, searchQuery, keeperTarget, autoAdvance,
    selectedFrameId: existingId(selectedFrameId),
    compareRightFrameId: existingId(compareRightFrameId),
    undoStack: [], redoStack: [],
  };
}
