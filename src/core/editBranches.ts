import type { PhotoFrame } from './types';
import { recipeAt, type EditHistory } from './editHistory';

/**
 * One physical photograph, multiple non-destructive editing timelines.
 *
 * The live PhotoFrame fields describe the ACTIVE version. Inactive versions
 * are stored as metadata/recipes here. Neither original bytes nor previews
 * are copied into these snapshots. This also avoids duplicate catalogue
 * stableKeys and misleading additional imported photographs.
 */
export type BranchSnapshot = Pick<PhotoFrame,
  'edit' | 'editHistory' | 'framing' | 'focusPoint' | 'sizeCrops' |
  'formats' | 'formatHistory' | 'sizeLinked' | 'overlay' |
  'boardPositions' | 'appliedLookId' | 'formatSplits' | 'splitFrames' |
  'splitPanOffset' | 'videoZoom'>;

export interface EditVersion {
  id: string;
  label: string;
  parentId: string | null;
  forkCursor: number;
  createdAt: number;
  snapshot: BranchSnapshot;
}

export interface EditVersionTree {
  version: 1;
  activeId: string;
  versions: EditVersion[];
}

export const ROOT_VERSION_ID = 'version-original';
export const MAX_EDIT_VERSIONS = 32;

const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(id);

const copy = <T>(value: T): T => value === undefined ? value : structuredClone(value);

function capture(frame: PhotoFrame): BranchSnapshot {
  return {
    edit: copy(frame.edit),
    editHistory: copy(frame.editHistory),
    framing: copy(frame.framing),
    focusPoint: copy(frame.focusPoint),
    sizeCrops: copy(frame.sizeCrops),
    formats: copy(frame.formats),
    formatHistory: copy(frame.formatHistory),
    sizeLinked: copy(frame.sizeLinked),
    overlay: copy(frame.overlay),
    boardPositions: copy(frame.boardPositions),
    appliedLookId: frame.appliedLookId,
    formatSplits: copy(frame.formatSplits),
    splitFrames: copy(frame.splitFrames),
    splitPanOffset: copy(frame.splitPanOffset),
    videoZoom: copy(frame.videoZoom),
  };
}

function restore(frame: PhotoFrame, snapshot: BranchSnapshot): PhotoFrame {
  // Only restore versionable editing fields. A damaged catalogue snapshot
  // must NEVER be able to overwrite the imported file's identity, SHA-256,
  // location, ownership, ratings, culling decision or RAW provenance.
  return {
    ...frame,
    edit: copy(snapshot.edit),
    editHistory: copy(snapshot.editHistory),
    framing: copy(snapshot.framing),
    focusPoint: copy(snapshot.focusPoint),
    sizeCrops: copy(snapshot.sizeCrops),
    formats: copy(snapshot.formats),
    formatHistory: copy(snapshot.formatHistory),
    sizeLinked: copy(snapshot.sizeLinked),
    overlay: copy(snapshot.overlay),
    boardPositions: copy(snapshot.boardPositions),
    appliedLookId: snapshot.appliedLookId,
    formatSplits: copy(snapshot.formatSplits),
    splitFrames: copy(snapshot.splitFrames),
    splitPanOffset: copy(snapshot.splitPanOffset),
    videoZoom: copy(snapshot.videoZoom),
  };
}

/** Defensive boundary for old or damaged project catalogues. */
export function readEditVersions(raw: unknown): EditVersionTree | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const tree = raw as Partial<EditVersionTree>;
  if (tree.version !== 1 || !validId(tree.activeId) || !Array.isArray(tree.versions)
      || tree.versions.length < 1 || tree.versions.length > MAX_EDIT_VERSIONS) return undefined;
  const seen = new Set<string>();
  for (const version of tree.versions) {
    if (!version || !validId(version.id) || seen.has(version.id)
      || typeof version.label !== 'string' || version.label.length > 80
      || !Number.isSafeInteger(version.forkCursor) || version.forkCursor < 0
      || !Number.isSafeInteger(version.createdAt) || version.createdAt < 0
      || (version.parentId !== null && !validId(version.parentId))
      || !version.snapshot || typeof version.snapshot !== 'object') return undefined;
    seen.add(version.id);
  }
  if (!seen.has(tree.activeId)) return undefined;
  return tree as EditVersionTree;
}

/** A display-only branch list: never expose stored snapshots to the UI. */
export function describeEditVersions(raw: unknown): Array<Pick<EditVersion,
  'id' | 'label' | 'parentId' | 'forkCursor' | 'createdAt'>> {
  const tree = readEditVersions(raw);
  if (!tree) return [{ id: ROOT_VERSION_ID, label: 'Version 1',
    parentId: null, forkCursor: 0, createdAt: 0 }];
  return tree.versions.map(({ id, label, parentId, forkCursor, createdAt }) =>
    ({ id, label, parentId, forkCursor, createdAt }));
}

/**
 * Fork from any retained shared edit checkpoint without changing the parent.
 * A new branch starts with the exact edit+framing recipe recorded at that
 * checkpoint. Other format settings are copied as they stand NOW because
 * historical format rendering/checkpoint restoration is not yet supported;
 * we must never pretend those settings are an old rendered snapshot.
 */
export function forkEditCheckpoint(
  frame: PhotoFrame, cursor: number, newId: string, at: number,
): PhotoFrame {
  const history = frame.editHistory;
  if (!history || !Number.isSafeInteger(cursor)
      || cursor < 0 || cursor > history.steps.length
      || !validId(newId) || newId === ROOT_VERSION_ID
      || !Number.isSafeInteger(at) || at <= 0) return frame;
  const tree = readEditVersions(frame.editVersions);
  if (frame.editVersions && !tree) return frame; // corrupt records must fail closed
  const previous = tree ?? { version: 1 as const, activeId: ROOT_VERSION_ID,
    versions: [{ id: ROOT_VERSION_ID, label: 'Version 1',
      parentId: null, forkCursor: 0, createdAt: 0, snapshot: capture(frame) }] };
  if (previous.versions.length >= MAX_EDIT_VERSIONS ||
      previous.versions.some(version => version.id === newId)) return frame;

  const parentVersions = previous.versions.map(version => version.id === previous.activeId
    ? { ...version, snapshot: capture(frame) } : version);
  // A newly forked version may still have zero edit steps. Its step zero
  // is the recipe already materialised in that version, and may be forked
  // again without inventing a historical source image.
  const selected = history.steps.length
    ? recipeAt(history, cursor)
    : { edit: frame.edit, framing: frame.framing };
  if (!selected) return frame;
  const forkHistory: EditHistory = {
    ...history,
    steps: copy(history.steps.slice(0, cursor)),
    cursor,
  };
  const forked = restore(frame, {
    ...capture(frame), edit: copy(selected.edit), framing: copy(selected.framing),
    editHistory: forkHistory, focusPoint: undefined,
  });
  const next: EditVersion = {
    id: newId, label: `Version ${parentVersions.length + 1}`,
    parentId: previous.activeId, forkCursor: cursor, createdAt: at,
    snapshot: capture(forked),
  };
  return { ...forked, editVersions: {
    version: 1, activeId: newId, versions: [...parentVersions, next],
  } };
}

/** Save the outgoing live recipe and restore the chosen branch in-place. */
export function switchEditVersion(frame: PhotoFrame, targetId: string): PhotoFrame {
  const tree = readEditVersions(frame.editVersions);
  if (!tree || tree.activeId === targetId) return frame;
  const target = tree.versions.find(version => version.id === targetId);
  if (!target) return frame;
  const versions = tree.versions.map(version => version.id === tree.activeId
    ? { ...version, snapshot: capture(frame) } : version);
  return { ...restore(frame, target.snapshot), editVersions: {
    version: 1, activeId: targetId, versions,
  } };
}
