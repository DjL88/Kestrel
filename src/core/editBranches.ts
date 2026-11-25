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
  'splitPanOffset' | 'videoZoom' | 'v2EditGroups'>;

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
    v2EditGroups: copy(frame.v2EditGroups),
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
    // Older versions had no group snapshots: retain their live groups rather than erasing them.
    v2EditGroups: snapshot.v2EditGroups === undefined ? frame.v2EditGroups : copy(snapshot.v2EditGroups),
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
      || !version.snapshot || typeof version.snapshot !== 'object' || Array.isArray(version.snapshot)) return undefined;
    seen.add(version.id);
  }
  if (!seen.has(tree.activeId)) return undefined;
  const byId = new Map(tree.versions.map(version => [version.id, version]));
  if (byId.get(ROOT_VERSION_ID)?.parentId !== null) return undefined;
  // A valid lineage must terminate at the permanent root. Refuse missing
  // parents, disconnected roots and cycles before restoring any snapshot.
  for (const version of tree.versions) {
    let current: EditVersion | undefined = version;
    const chain = new Set<string>();
    while (current && current.id !== ROOT_VERSION_ID) {
      if (chain.has(current.id) || current.parentId === null) return undefined;
      chain.add(current.id);
      current = byId.get(current.parentId);
    }
    if (!current) return undefined;
  }
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

/** The saved tree, or a one-version tree holding the live photo. Undefined when a saved tree is damaged (fail closed). */
function currentTree(frame: PhotoFrame): EditVersionTree | undefined {
  const tree = readEditVersions(frame.editVersions);
  if (frame.editVersions && !tree) return undefined;
  return tree ?? { version: 1, activeId: ROOT_VERSION_ID,
    versions: [{ id: ROOT_VERSION_ID, label: 'Version 1',
      parentId: null, forkCursor: 0, createdAt: 0, snapshot: capture(frame) }] };
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
  const previous = currentTree(frame);
  if (!previous || previous.versions.length >= MAX_EDIT_VERSIONS ||
      previous.versions.some(version => version.id === newId)) return frame;

  const parentVersions = previous.versions.map(version => version.id === previous.activeId
    ? { ...version, snapshot: capture(frame) } : version);
  // A newly forked version may still have zero edit steps. Its step zero
  // is the recipe already materialised in that version, and may be forked
  // again without inventing a historical source image.
  const selected = history.steps.length
    ? recipeAt(history, cursor)
    : { edit: frame.edit, framing: frame.framing, overlay: frame.overlay,
      formatSplits: frame.formatSplits };
  if (!selected) return frame;
  const forkHistory: EditHistory = {
    ...history,
    steps: copy(history.steps.slice(0, cursor)),
    cursor,
  };
  const forked = restore(frame, {
    ...capture(frame), edit: copy(selected.edit), framing: copy(selected.framing),
    // Old saved checkpoints lacked overlays. Retain the live overlay rather than guessing history.
    overlay: (('overlayRecorded' in selected && selected.overlayRecorded === true) || 'overlay' in selected) ? copy(selected.overlay) : copy(frame.overlay),
    // New edit checkpoints include the exact split state. Earlier catalogues
    // had no such evidence: retain the current layout rather than fabricating
    // an old one. This mirrors the existing overlay compatibility rule.
    formatSplits: 'formatSplits' in selected ? copy(selected.formatSplits) : copy(frame.formatSplits),
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

/** Version and checkpoint names: trimmed, single-spaced, at most this many characters. Empty is refused. */
export const MAX_NAME_LENGTH = 60;
export function cleanName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
  return clean || undefined;
}

/** Give an editing version a person's own name. Nothing else about it changes. */
export function renameEditVersion(frame: PhotoFrame, versionId: string, name: string): PhotoFrame {
  const label = cleanName(name);
  const tree = currentTree(frame);
  if (!label || !tree || !tree.versions.some((version) => version.id === versionId)) return frame;
  return { ...frame, editVersions: { ...tree,
    versions: tree.versions.map((version) => version.id === versionId ? { ...version, label } : version) } };
}

/**
 * A named checkpoint: the whole editing state of the photo (recipe, crop of every format, overlays, history) at the
 * moment the person saved it. It is a recipe, never pixels, and it is not affected by later edits, by undo, or by the
 * history limit compacting old steps away. Returning to it opens it as a NEW editing version, so nothing is lost.
 */
export interface EditCheckpoint {
  id: string;
  name: string;
  createdAt: number;
  /** The editing version it was saved from, for the description only. */
  versionId: string;
  snapshot: BranchSnapshot;
}
export const MAX_CHECKPOINTS = 24;

/** Defensive read of saved checkpoints: a damaged entry is dropped, never guessed at. */
export function readCheckpoints(raw: unknown): EditCheckpoint[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EditCheckpoint[] = [];
  for (const entry of raw.slice(0, MAX_CHECKPOINTS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const c = entry as Partial<EditCheckpoint>;
    if (!validId(c.id) || seen.has(c.id) || cleanName(c.name) !== c.name || !validId(c.versionId)
      || !Number.isSafeInteger(c.createdAt) || (c.createdAt as number) <= 0
      || !c.snapshot || typeof c.snapshot !== 'object' || Array.isArray(c.snapshot)) continue;
    seen.add(c.id);
    out.push(c as EditCheckpoint);
  }
  return out;
}

/** Display-only list: snapshots never reach the interface. */
export function describeCheckpoints(raw: unknown): Array<Pick<EditCheckpoint, 'id' | 'name' | 'createdAt' | 'versionId'>> {
  return readCheckpoints(raw).map(({ id, name, createdAt, versionId }) => ({ id, name, createdAt, versionId }));
}

/** Save the photo's current editing state under a name. Refused (unchanged frame) when the name is empty or the list is full. */
export function saveCheckpoint(frame: PhotoFrame, id: string, name: string, at: number): PhotoFrame {
  const clean = cleanName(name);
  const existing = readCheckpoints(frame.editCheckpoints);
  if (!clean || !validId(id) || !Number.isSafeInteger(at) || at <= 0
    || existing.length >= MAX_CHECKPOINTS || existing.some((c) => c.id === id)) return frame;
  const versionId = readEditVersions(frame.editVersions)?.activeId ?? ROOT_VERSION_ID;
  return { ...frame, editCheckpoints: [...existing, { id, name: clean, createdAt: at, versionId, snapshot: capture(frame) }] };
}

/** Remove a checkpoint. The photo's edits and versions are untouched. */
export function deleteCheckpoint(frame: PhotoFrame, id: string): PhotoFrame {
  const existing = readCheckpoints(frame.editCheckpoints);
  if (!existing.some((c) => c.id === id)) return frame;
  const rest = existing.filter((c) => c.id !== id);
  return { ...frame, editCheckpoints: rest.length ? rest : undefined };
}

/**
 * Open a checkpoint as a new editing version named after it. The version you were on keeps its current state and can
 * be chosen again; the checkpoint itself stays as saved.
 */
export function restoreCheckpoint(frame: PhotoFrame, checkpointId: string, newId: string, at: number): PhotoFrame {
  const checkpoint = readCheckpoints(frame.editCheckpoints).find((c) => c.id === checkpointId);
  const tree = currentTree(frame);
  if (!checkpoint || !tree || !validId(newId) || newId === ROOT_VERSION_ID || !Number.isSafeInteger(at) || at <= 0
    || tree.versions.length >= MAX_EDIT_VERSIONS || tree.versions.some((version) => version.id === newId)) return frame;
  const versions = tree.versions.map((version) => version.id === tree.activeId ? { ...version, snapshot: capture(frame) } : version);
  const restored = restore(frame, checkpoint.snapshot);
  const next: EditVersion = {
    id: newId, label: checkpoint.name, parentId: tree.activeId,
    forkCursor: restored.editHistory?.cursor ?? 0, createdAt: at, snapshot: capture(restored),
  };
  return { ...restored, editVersions: { version: 1, activeId: newId, versions: [...versions, next] } };
}
