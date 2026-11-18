import { searchWords } from './subjectTags';
import { sameCaptureCamera, safeBurstGapMs } from './burstIdentity';
import { matchesRating } from './ratingFilter';
import type {
  CullCounts,
  CullDecision,
  CullingState,
  DemoAssetKey,
  FilterState,
  PhotoFrame,
  RatingFilter,
  ShootDescriptor,
  SortOrder,
} from './types';

export const DEFAULT_KEEPER_TARGET = 50;
export const DEFAULT_BURST_GAP_MS = 1500;

interface DemoSceneSpec {
  assetKey: DemoAssetKey;
  label: string;
  camera: string;
  lens: string;
  focalLengthMm: number;
  apertureF: number;
  shutterSpeed: string;
  iso: number;
  prefix: string;
}

const DEMO_SCENES: DemoSceneSpec[] = [
  {
    assetKey: 'red-kite',
    label: 'Red Kite banking over moorland',
    camera: 'NIKON Z 8',
    lens: 'NIKKOR Z 600mm f/6.3 VR S',
    focalLengthMm: 600,
    apertureF: 6.3,
    shutterSpeed: '1/2500s',
    iso: 800,
    prefix: 'Z8A',
  },
  {
    assetKey: 'kingfisher',
    label: 'Kingfisher on riverside perch',
    camera: 'NIKON Z 5II',
    lens: 'NIKKOR Z 180-600mm f/5.6-6.3 VR',
    focalLengthMm: 540,
    apertureF: 6.3,
    shutterSpeed: '1/1250s',
    iso: 1600,
    prefix: 'Z52',
  },
  {
    assetKey: 'barn-owl',
    label: 'Barn Owl quartering at dusk',
    camera: 'NIKON Z 8',
    lens: 'NIKKOR Z 400mm f/4.5 VR S',
    focalLengthMm: 400,
    apertureF: 4.5,
    shutterSpeed: '1/1600s',
    iso: 3200,
    prefix: 'Z8A',
  },
  {
    assetKey: 'collie-coco',
    label: 'Coco sprinting across heather',
    camera: 'NIKON Z 5II',
    lens: 'NIKKOR Z 70-200mm f/2.8 VR S',
    focalLengthMm: 185,
    apertureF: 2.8,
    shutterSpeed: '1/3200s',
    iso: 400,
    prefix: 'Z52',
  },
  {
    assetKey: 'red-fox',
    label: 'Red Fox in frosted bracken',
    camera: 'NIKON Z 8',
    lens: 'NIKKOR Z 400mm f/4.5 VR S',
    focalLengthMm: 400,
    apertureF: 4.5,
    shutterSpeed: '1/1000s',
    iso: 640,
    prefix: 'Z8A',
  },
  {
    assetKey: 'osprey',
    label: 'Osprey lifting off loch with trout',
    camera: 'NIKON Z 8',
    lens: 'NIKKOR Z 600mm f/6.3 VR S',
    focalLengthMm: 600,
    apertureF: 6.3,
    shutterSpeed: '1/3200s',
    iso: 1000,
    prefix: 'Z8A',
  },
];

/**
 * Deterministic PRNG so the 500-frame demo shoot produces identical sequences across reloads and tests.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Groups consecutive frames into bursts when capture timestamps are available
 * and within maxGapMs (default 1500ms). Single frames keep burstGroupId = null.
 */
export function assignBurstGroups(
  frames: PhotoFrame[],
  maxGapMs: number = DEFAULT_BURST_GAP_MS
): PhotoFrame[] {
  if (frames.length === 0) return [];
  const safeGapMs = safeBurstGapMs(maxGapMs);

  // Preserve relative order if timestamps are missing; otherwise sort chronologically first.
  const allHaveTimestamps = frames.every(
    (f) => typeof f.exif.capturedAtMs === 'number' && Number.isFinite(f.exif.capturedAtMs)
  );

  const ordered = allHaveTimestamps
    ? [...frames].sort((a, b) => (a.exif.capturedAtMs ?? 0) - (b.exif.capturedAtMs ?? 0))
    : [...frames];

  const clusters: PhotoFrame[][] = [];
  let currentCluster: PhotoFrame[] = [];

  for (const frame of ordered) {
    if (currentCluster.length === 0) {
      currentCluster.push(frame);
      continue;
    }

    const prev = currentCluster[currentCluster.length - 1];
    const prevTs = prev.exif.capturedAtMs;
    const currTs = frame.exif.capturedAtMs;

    if (
      typeof prevTs === 'number' &&
      typeof currTs === 'number' &&
      currTs - prevTs >= 0 &&
      currTs - prevTs <= safeGapMs
      // Two cameras can shoot within the same millisecond window; do not
      // mistake interleaved Z8/Z5II captures for a single burst.
      // Missing camera tags must not bridge two different known cameras.
      && sameCaptureCamera(frame.exif.camera, currentCluster.map((member) => member.exif.camera))
    ) {
      currentCluster.push(frame);
    } else {
      clusters.push(currentCluster);
      currentCluster = [frame];
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  let burstSeq = 0;
  const result: PhotoFrame[] = [];
  let seqIdx = 0;

  for (const cluster of clusters) {
    if (cluster.length >= 2) {
      burstSeq += 1;
      const burstGroupId = `burst-${burstSeq}`;
      const burstCount = cluster.length;
      cluster.forEach((frame, idx) => {
        seqIdx += 1;
        result.push({
          ...frame,
          sequenceIndex: seqIdx,
          burstGroupId,
          burstIndex: idx + 1,
          burstCount,
        });
      });
    } else {
      seqIdx += 1;
      result.push({
        ...cluster[0],
        sequenceIndex: seqIdx,
        burstGroupId: null,
        burstIndex: 1,
        burstCount: 1,
      });
    }
  }

  return result;
}

/**
 * Generates a realistic, deterministic 500-frame Nikon Z8 / Z5II wildlife, bird & pet demo shoot.
 */
export function generateDemoShootFrames(count: number = 500): PhotoFrame[] {
  const rand = mulberry32(20261114);
  const rawFrames: PhotoFrame[] = [];
  const baseTimestamp = Date.UTC(2026, 9, 18, 7, 15, 0);
  let cursorMs = baseTimestamp;
  let frameCounter = 0;

  while (frameCounter < count) {
    const scene = DEMO_SCENES[Math.floor(rand() * DEMO_SCENES.length)];
    // ~82% of frames occur in bursts of 3..11 frames; ~18% are single frames
    const isBurst = rand() < 0.82 && count - frameCounter >= 2;
    const burstLength = isBurst
      ? Math.min(count - frameCounter, 3 + Math.floor(rand() * 9))
      : 1;

    // Pick 1-2 sharpest "hero" positions in a burst and 1-2 slightly soft frames for realistic Compare mode
    const sharpIndex = frameCounter === 0 ? 0 : Math.floor(rand() * burstLength);

    for (let i = 0; i < burstLength; i += 1) {
      frameCounter += 1;
      const padded = String(frameCounter).padStart(4, '0');
      const filename = `${scene.prefix}_${padded}.NEF`;
      const isSharpHero = i === sharpIndex;
      const isSlightlySoft = !isSharpHero && burstLength >= 3 && rand() < 0.35;

      const panX = Number(((rand() - 0.5) * 4.2).toFixed(2));
      const panY = Number(((rand() - 0.5) * 3.0).toFixed(2));
      const cropScale = Number((1.01 + rand() * 0.05).toFixed(3));
      const softnessPx = isSlightlySoft ? Number((0.45 + rand() * 0.5).toFixed(2)) : 0;

      // Subtle exposure / ISO variation across bursts
      const isoChoices = [scene.iso, scene.iso, Math.round(scene.iso * 1.25)];
      const iso = isoChoices[Math.floor(rand() * isoChoices.length)];

      rawFrames.push({
        id: `demo-frame-${padded}`,
        stableKey: `demo://loch-ruthven/${filename}`,
        filename,
        sequenceIndex: frameCounter,
        decision: 'unreviewed',
        burstGroupId: null,
        burstIndex: 1,
        burstCount: 1,
        isDemo: true,
        sourceKind: 'demo',
        demoVariant: {
          assetKey: scene.assetKey,
          panX,
          panY,
          cropScale,
          softnessPx,
          demoSceneLabel: scene.label,
        },
        exif: {
          camera: scene.camera,
          lens: scene.lens,
          focalLengthMm: scene.focalLengthMm,
          apertureF: scene.apertureF,
          shutterSpeed: scene.shutterSpeed,
          iso,
          capturedAtMs: cursorMs,
          width: scene.camera === 'NIKON Z 8' ? 8256 : 6048,
          height: scene.camera === 'NIKON Z 8' ? 5504 : 4032,
          formatLabel: 'Demo NEF (Simulated Preview)',
          isEmbeddedPreviewOnly: false,
        },
      });

      // Within burst: 50ms-140ms (7-20fps Z8/Z5II burst cadence)
      cursorMs += 55 + Math.floor(rand() * 85);
    }

    // Gap between bursts/singles: 8 seconds to 2.5 minutes
    cursorMs += 8000 + Math.floor(rand() * 140000);
  }

  return assignBurstGroups(rawFrames, DEFAULT_BURST_GAP_MS);
}

export function createDemoShootState(count: number = 500): CullingState {
  const frames = generateDemoShootFrames(count);
  const now = Date.now();
  const shoot: ShootDescriptor = {
    id: 'demo-nikon-z-wildlife',
    title: 'Highland Wildlife & Coco (Demo Shoot)',
    sourceKind: 'demo',
    totalFrames: frames.length,
    createdAt: now,
    lastUpdatedAt: now,
  };

  return {
    shoot,
    frames,
    selectedFrameId: frames[0]?.id ?? null,
    compareRightFrameId: frames[1]?.id ?? null,
    filter: 'all',
    searchQuery: '',
    keeperTarget: DEFAULT_KEEPER_TARGET,
    autoAdvance: true,
    undoStack: [],
    redoStack: [],
  };
}

export function computeCullCounts(frames: readonly PhotoFrame[]): CullCounts {
  let unreviewed = 0;
  let keep = 0;
  let reject = 0;

  let all = 0;
  for (const frame of frames) {
    if (frame.removedAt != null) continue;
    all += 1;
    if (frame.decision === 'keep') keep += 1;
    else if (frame.decision === 'reject') reject += 1;
    else unreviewed += 1;
  }

  return {
    all,
    unreviewed,
    keep,
    reject,
  };
}

export function filterFrames(
  frames: readonly PhotoFrame[],
  filter: FilterState,
  searchQuery: string = '',
  ratingFilter?: RatingFilter | null,
  cameraFilter?: string | null,
  lensFilter?: string | null
): PhotoFrame[] {
  const query = searchQuery.trim().toLowerCase();
  return frames.filter((frame) => {
    if (frame.removedAt != null) return false;
    if (filter !== 'all' && frame.decision !== filter) {
      return false;
    }
    if (!matchesRating(frame, ratingFilter)) return false;
    if (cameraFilter && frame.exif.camera !== cameraFilter) return false;
    if (lensFilter && frame.exif.lens !== lensFilter) return false;
    if (!query) return true;
    const haystack = [
      frame.filename,
      frame.exif.camera ?? '',
      frame.exif.lens ?? '',
      frame.demoVariant?.demoSceneLabel ?? '',
      ...searchWords(frame),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

const CONFIDENCE_RANK: Record<'high' | 'medium' | 'low', number> = { high: 2, medium: 1, low: 0 };

/** Order already-filtered frames for display. No `sortOrder` leaves the existing (import/catalogue) order alone -
 * this only reorders once the person actively picks a sort. Stable: ties keep their existing relative order. */
export function sortFrames(frames: readonly PhotoFrame[], sortOrder?: SortOrder): PhotoFrame[] {
  if (!sortOrder) return [...frames];
  const ordered = [...frames];
  switch (sortOrder) {
    case 'edited-desc': {
      // Only active history steps describe the current image. Undone edits must not
      // appear as recent changes, and old imports without timestamps belong last.
      const currentEditAt = (frame: PhotoFrame): number | null => {
        const history = frame.editHistory;
        if (!history || !Number.isInteger(history.cursor) || history.cursor < 1 || history.cursor > history.steps.length) return null;
        const at = history.steps[history.cursor - 1]?.at;
        return typeof at === 'number' && Number.isFinite(at) && at >= 0 ? at : null;
      };
      ordered.sort((a, b) => (currentEditAt(b) ?? -1) - (currentEditAt(a) ?? -1));
      break;
    }
    case 'captured-asc':
      ordered.sort((a, b) => (a.exif.capturedAtMs ?? 0) - (b.exif.capturedAtMs ?? 0));
      break;
    case 'rating-desc':
      ordered.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      break;
    case 'name-asc':
      ordered.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
      break;
    case 'confidence-desc':
      // Frames auto-cull has never scored sort after every scored one, regardless of confidence.
      ordered.sort((a, b) => {
        // Persisted catalogues may predate scan validation or contain corrupt
        // values. Treat those as unscored, rather than returning NaN from sort.
        const scoreA = typeof a.cullScore === 'number' && Number.isFinite(a.cullScore) &&
          a.cullScore >= 0 && a.cullScore <= 100 ? a.cullScore : null;
        const scoreB = typeof b.cullScore === 'number' && Number.isFinite(b.cullScore) &&
          b.cullScore >= 0 && b.cullScore <= 100 ? b.cullScore : null;
        const rankA = scoreA !== null && (a.cullConfidence === 'high' || a.cullConfidence === 'medium' || a.cullConfidence === 'low')
          ? CONFIDENCE_RANK[a.cullConfidence!] : -1;
        const rankB = scoreB !== null && (b.cullConfidence === 'high' || b.cullConfidence === 'medium' || b.cullConfidence === 'low')
          ? CONFIDENCE_RANK[b.cullConfidence!] : -1;
        if (rankA !== rankB) return rankB - rankA;
        return rankA === -1 ? 0 : scoreB! - scoreA!;
      });
      break;
    case 'captured-desc':
      ordered.sort((a, b) => (b.exif.capturedAtMs ?? 0) - (a.exif.capturedAtMs ?? 0));
      break;
  }
  return ordered;
}

/** Record what the last auto-cull scan found for each photo it looked at, so it can be sorted on later. Never
 * touches `decision`: applying a suggestion is still a separate, explicit step. */
export function applyCullConfidence(
  state: CullingState,
  results: readonly { frameId: string; confidence: 'high' | 'medium' | 'low'; score: number }[]
): CullingState {
  if (!results.length) return state;
  // Worker messages and persisted results can be malformed despite their TS types.
  // Never store NaN/out-of-range scores: confidence sorting must stay stable.
  // Duplicate or contradictory scan entries are ambiguous, not a last-writer win.
  const byId = new Map<string, (typeof results)[number]>();
  const ambiguous = new Set<string>();
  for (const result of results) {
    // Even a malformed second entry makes the ID ambiguous. Do not let a
    // valid/invalid pair become an order-dependent confidence update.
    if (!result || typeof result.frameId !== 'string' || !result.frameId) continue;
    if (byId.has(result.frameId) || ambiguous.has(result.frameId)) {
      ambiguous.add(result.frameId);
      byId.delete(result.frameId);
      continue;
    }
    if (!Number.isFinite(result.score) || result.score < 0 || result.score > 100 ||
        !['high', 'medium', 'low'].includes(result.confidence)) {
      ambiguous.add(result.frameId);
      continue;
    }
    byId.set(result.frameId, result);
  }
  // A damaged catalogue can contain two photos with the same identity. Never
  // attach one worker result to both, or resurrect a removed photo's score.
  const seen = new Set<string>();
  for (const frame of state.frames) {
    if (seen.has(frame.id)) ambiguous.add(frame.id);
    seen.add(frame.id);
  }
  for (const id of ambiguous) byId.delete(id);
  return {
    ...state,
    frames: state.frames.map((frame) => {
      // A removed photo must not retain a stale ranking signal when a delayed
      // worker batch arrives. This only clears advisory scan metadata; never
      // changes the removal marker, manual decision or undo history.
      if (frame.removedAt != null) {
        return frame.cullConfidence !== undefined || frame.cullScore !== undefined
          ? { ...frame, cullConfidence: undefined, cullScore: undefined }
          : frame;
      }
      const found = byId.get(frame.id);
      if (found) return { ...frame, cullConfidence: found.confidence, cullScore: found.score };
      // A later malformed/duplicate result must not leave an earlier high
      // confidence looking current. Preserve decisions and undo/redo history.
      if (ambiguous.has(frame.id) && (frame.cullConfidence !== undefined || frame.cullScore !== undefined)) {
        return { ...frame, cullConfidence: undefined, cullScore: undefined };
      }
      return frame;
    }),
  };
}

export function stepSelection(
  visibleFrames: readonly PhotoFrame[],
  currentId: string | null,
  delta: number
): string | null {
  // Stale views can include a removed photograph. Never navigate back to it.
  const active = visibleFrames.filter((frame) => frame.removedAt == null);
  if (active.length === 0) return null;
  if (!currentId) return active[0].id;
  const idx = active.findIndex((frame) => frame.id === currentId);
  if (idx === -1) return active[0].id;
  // Invalid keyboard/trackpad deltas must never index the array with NaN,
  // Infinity or a fractional value and return an undefined selection.
  if (!Number.isFinite(delta)) return active[idx].id;
  const offset = Math.trunc(delta);
  const nextIdx = Math.max(0, Math.min(active.length - 1, idx + offset));
  return active[nextIdx].id;
}

export function getDefaultComparePair(
  frames: readonly PhotoFrame[],
  activeId: string | null
): { leftId: string | null; rightId: string | null } {
  // A stale compare selection can point to a removed photograph. Neither
  // side of the comparison may display removed catalogue entries.
  const available = frames.filter((frame) => frame.removedAt == null);
  if (available.length === 0) return { leftId: null, rightId: null };
  const idx = activeId ? available.findIndex((f) => f.id === activeId) : 0;
  const safeIdx = idx === -1 ? 0 : idx;
  const left = available[safeIdx];

  if (available.length === 1) {
    // A one-photo shoot has nothing to compare. Showing the same image as
    // both A and B suggests a second candidate exists when it does not.
    return { leftId: left.id, rightId: null };
  }

  // Prefer the next frame in the same burst, else previous in same burst, else next frame overall.
  // A stale or damaged catalogue can contain repeated IDs or removed photos.
  // Compare must never present either as a distinct candidate.
  const nextFrame = available.slice(safeIdx + 1).find((f) => f.id !== left.id);
  const prevFrame = available.slice(0, safeIdx).reverse().find((f) => f.id !== left.id);

  if (
    nextFrame &&
    left.burstGroupId &&
    nextFrame.burstGroupId === left.burstGroupId
  ) {
    return { leftId: left.id, rightId: nextFrame.id };
  }

  if (
    prevFrame &&
    left.burstGroupId &&
    prevFrame.burstGroupId === left.burstGroupId
  ) {
    return { leftId: prevFrame.id, rightId: left.id };
  }

  return {
    leftId: left.id,
    rightId: nextFrame?.id ?? prevFrame?.id ?? null,
  };
}

export function applyDecisionWithHistory(
  state: CullingState,
  frameId: string,
  nextDecision: CullDecision,
  options?: { allowAdvance?: boolean }
): CullingState {
  const targetIdx = state.frames.findIndex((f) => f.id === frameId);
  if (targetIdx === -1) return state;
  // A damaged catalogue can contain two distinct photos with one ID.
  // A manual decision would update only the first, but Undo/Redo resolves by ID
  // and would then silently change both. Refuse ambiguous edits until repaired.
  if (state.frames.some((frame, index) => index !== targetIdx && frame.id === frameId)) return state;

  const targetFrame = state.frames[targetIdx];
  // A stale filmstrip/compare callback must never reclassify a photo already removed
  // from the library. Restoration is a separate, explicit action.
  if (targetFrame.removedAt != null) return state;
  const visibleBefore = filterFrames(state.frames, state.filter, state.searchQuery, state.ratingFilter, state.cameraFilter, state.lensFilter);
  const visibleIdx = visibleBefore.findIndex((f) => f.id === frameId);

  const shouldAdvance = options?.allowAdvance ?? state.autoAdvance;

  let nextSelectedId = state.selectedFrameId;
  if (shouldAdvance && state.selectedFrameId === frameId) {
    if (visibleIdx !== -1 && visibleIdx + 1 < visibleBefore.length) {
      nextSelectedId = visibleBefore[visibleIdx + 1].id;
    } else if (visibleIdx > 0 && state.filter !== 'all' && nextDecision !== state.filter) {
      // Last item in a filtered bucket removed by state change -> move to previous visible
      nextSelectedId = visibleBefore[visibleIdx - 1].id;
    }
    // Do not fall back to the raw catalogue: it can contain removed photos
    // or frames excluded by search/rating filters. At the end of the visible
    // queue, stay on the current photo until the user chooses another.
  }

  // If decision is unchanged, still advance if autoAdvance is enabled and user pressed Keep/Reject
  if (targetFrame.decision === nextDecision) {
    if (nextSelectedId !== state.selectedFrameId) {
      return {
        ...state,
        selectedFrameId: nextSelectedId,
      };
    }
    return state;
  }

  const updatedFrames = state.frames.map((f, idx) =>
    idx === targetIdx ? { ...f, decision: nextDecision } : f
  );

  // Ensure selected frame stays valid if filtered out
  const visibleAfter = filterFrames(updatedFrames, state.filter, state.searchQuery, state.ratingFilter, state.cameraFilter, state.lensFilter);
  if (nextSelectedId && !visibleAfter.some((f) => f.id === nextSelectedId)) {
    // Removing the current photo should leave the eye at the same place in the queue.
    const nextIndex = Math.max(0, Math.min(visibleAfter.length - 1, visibleIdx));
    nextSelectedId = visibleAfter[nextIndex]?.id ?? null;
  }

  const entry = {
    frameId,
    prevDecision: targetFrame.decision,
    nextDecision,
    prevSelectedId: state.selectedFrameId,
    nextSelectedId,
  };

  return {
    ...state,
    shoot: {
      ...state.shoot,
      lastUpdatedAt: Date.now(),
    },
    frames: updatedFrames,
    selectedFrameId: nextSelectedId,
    undoStack: [...state.undoStack.slice(-199), entry],
    redoStack: [],
  };
}

export function applyAutoCullDecisions(
  state: CullingState, requested: { frameId: string; decision: 'keep' | 'reject' }[],
): CullingState {
  // A repeated scan may deliver contradictory results for the same photo.
  // Never let input ordering silently turn a Keep into a Reject (or vice versa).
  // Conflicting IDs require an explicit human decision instead.
  const byId = new Map<string, 'keep' | 'reject'>();
  const conflicts = new Set<string>();
  for (const result of requested) {
    // Runtime callers (including persisted or worker results) can bypass TS types.
    // Invalid decisions must never enter a photo's review history.
    if (!result || typeof result.frameId !== 'string' || !result.frameId ||
        (result.decision !== 'keep' && result.decision !== 'reject')) continue;
    if (byId.has(result.frameId) && byId.get(result.frameId) !== result.decision) {
      conflicts.add(result.frameId);
    } else if (!conflicts.has(result.frameId)) {
      byId.set(result.frameId, result.decision);
    }
  }
  for (const id of conflicts) byId.delete(id);
  // Corrupt or stale catalogues can contain the same frame ID more than once.
  // Never classify multiple photographs from a single suggestion.
  const seenFrameIds = new Set<string>();
  const ambiguousFrameIds = new Set<string>();
  for (const frame of state.frames) {
    if (seenFrameIds.has(frame.id)) ambiguousFrameIds.add(frame.id);
    seenFrameIds.add(frame.id);
  }
  for (const id of ambiguousFrameIds) byId.delete(id);
  const batch: NonNullable<CullingState['undoStack'][number]['batch']> = [];
  const frames = state.frames.map((frame) => {
    const decision = byId.get(frame.id);
    if (!decision || frame.removedAt != null || frame.decision !== 'unreviewed' || frame.isDemo || frame.virtualCopy) return frame;
    batch.push({ frameId: frame.id, prevDecision: frame.decision, nextDecision: decision });
    return { ...frame, decision };
  });
  if (!batch.length) return state;
  const visible = filterFrames(frames, state.filter, state.searchQuery, state.ratingFilter, state.cameraFilter, state.lensFilter);
  const selectedFrameId = visible.some((frame) => frame.id === state.selectedFrameId)
    ? state.selectedFrameId : visible[0]?.id ?? null;
  return {
    ...state, frames, selectedFrameId,
    shoot: { ...state.shoot, lastUpdatedAt: Date.now() },
    undoStack: [...state.undoStack.slice(-199), {
      ...batch[0], batch, prevSelectedId: state.selectedFrameId, nextSelectedId: selectedFrameId,
    }],
    redoStack: [],
  };
}

/** Do not replay history against an ambiguous catalogue identity. */
function historyTargetsAreUnique(state: CullingState, entry: CullingState['undoStack'][number]): boolean {
  const counts = new Map<string, number>();
  for (const frame of state.frames) counts.set(frame.id, (counts.get(frame.id) ?? 0) + 1);
  return (entry.batch ?? [entry]).every((change) => counts.get(change.frameId) === 1);
}

function restoreFlags(state: CullingState, entry: CullingState['undoStack'][number], direction: 'prevDecision' | 'nextDecision') {
  const changes = new Map((entry.batch ?? [entry]).map((change) => [change.frameId, change[direction]]));
  return state.frames.map((frame) => {
    const decision = changes.get(frame.id);
    if (!decision) return frame;
    if (entry.removal) {
      // Undo brings the photo back into the library, and redo removes it again.
      const { removedAt: _removedAt, ...kept } = frame;
      return direction === 'prevDecision' ? { ...kept, decision } : { ...frame, decision, removedAt: Date.now() };
    }
    return { ...frame, decision };
  });
}

/** A persisted ID must identify exactly one photo before changing its Trash state. */
function unambiguousRequestedIds(frames: readonly PhotoFrame[], requested: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const frame of frames) counts.set(frame.id, (counts.get(frame.id) ?? 0) + 1);
  return new Set(requested.filter((id) => counts.get(id) === 1));
}

/** Take photos that are already in Trash out of the library. Files on disk are never touched, and Restore reverses it. */
export function removeFromLibrary(state: CullingState, frameIds: string[]): CullingState {
  const ids = unambiguousRequestedIds(state.frames, frameIds);
  const targets = state.frames.filter((frame) => ids.has(frame.id) && frame.decision === 'reject' && frame.removedAt == null);
  if (!targets.length) return state;
  const removing = new Set(targets.map((frame) => frame.id));
  const visibleBefore = filterFrames(state.frames, state.filter, state.searchQuery, state.ratingFilter, state.cameraFilter, state.lensFilter);
  const firstIndex = visibleBefore.findIndex((frame) => removing.has(frame.id));
  const frames = state.frames.map((frame) => removing.has(frame.id) ? { ...frame, removedAt: Date.now() } : frame);
  const visibleAfter = filterFrames(frames, state.filter, state.searchQuery, state.ratingFilter, state.cameraFilter, state.lensFilter);
  const selectedFrameId = state.selectedFrameId && visibleAfter.some((frame) => frame.id === state.selectedFrameId)
    ? state.selectedFrameId
    : visibleAfter[Math.max(0, Math.min(visibleAfter.length - 1, firstIndex))]?.id ?? null;
  const batch = targets.map((frame) => ({ frameId: frame.id, prevDecision: 'reject' as const, nextDecision: 'reject' as const }));
  return {
    ...state, frames, selectedFrameId,
    compareRightFrameId: state.compareRightFrameId && removing.has(state.compareRightFrameId) ? null : state.compareRightFrameId,
    shoot: { ...state.shoot, lastUpdatedAt: Date.now() },
    undoStack: [...state.undoStack.slice(-199), {
      ...batch[0], batch, removal: true, prevSelectedId: state.selectedFrameId, nextSelectedId: selectedFrameId,
    }],
    redoStack: [],
  };
}

export function removedFrames(frames: readonly PhotoFrame[]): PhotoFrame[] {
  return frames.filter((frame) => frame.removedAt != null).sort((a, b) => (b.removedAt ?? 0) - (a.removedAt ?? 0));
}

/** Bring removed photos back. They return to Trash so nothing reappears among Keepers by surprise. */
export function restoreRemoved(state: CullingState, frameIds: string[]): CullingState {
  const ids = unambiguousRequestedIds(state.frames, frameIds);
  if (!state.frames.some((frame) => ids.has(frame.id) && frame.removedAt != null)) return state;
  const frames = state.frames.map((frame) => {
    if (!ids.has(frame.id) || frame.removedAt == null) return frame;
    const { removedAt: _removedAt, ...kept } = frame;
    return kept;
  });
  // Explicit restoration is a new user action: an earlier redo must not silently remove it again.
  // Explicit Restore must not retain an undo that can recreate an unintended removal.
  // Keep unrelated review and removal history.
  const restoredIds = new Set(state.frames.filter((frame) => ids.has(frame.id) && frame.removedAt != null).map((frame) => frame.id));
  const undoStack = state.undoStack.filter((entry) =>
    !entry.removal || !(entry.batch ?? [entry]).some((change) => restoredIds.has(change.frameId))
  );
  return { ...state, frames, shoot: { ...state.shoot, lastUpdatedAt: Date.now() }, undoStack, redoStack: [] };
}

export function undoDecision(state: CullingState): CullingState {
  if (state.undoStack.length === 0) return state;
  const entry = state.undoStack[state.undoStack.length - 1];
  // Leave history intact so the user can repair the catalogue before retrying.
  if (!historyTargetsAreUnique(state, entry)) return state;
  const updatedFrames = restoreFlags(state, entry, 'prevDecision');

  return {
    ...state,
    shoot: {
      ...state.shoot,
      lastUpdatedAt: Date.now(),
    },
    frames: updatedFrames,
    selectedFrameId: entry.batch ? entry.prevSelectedId : entry.frameId,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, entry],
  };
}

export function redoDecision(state: CullingState): CullingState {
  if (state.redoStack.length === 0) return state;
  const entry = state.redoStack[state.redoStack.length - 1];
  // Leave history intact so the user can repair the catalogue before retrying.
  if (!historyTargetsAreUnique(state, entry)) return state;
  const updatedFrames = restoreFlags(state, entry, 'nextDecision');

  const visibleAfter = filterFrames(updatedFrames, state.filter, state.searchQuery, state.ratingFilter, state.cameraFilter, state.lensFilter);
  const candidateSelection =
    entry.nextSelectedId && visibleAfter.some((f) => f.id === entry.nextSelectedId)
      ? entry.nextSelectedId
      : visibleAfter.some((f) => f.id === entry.frameId)
      ? entry.frameId
      : visibleAfter[0]?.id ?? null;

  return {
    ...state,
    shoot: {
      ...state.shoot,
      lastUpdatedAt: Date.now(),
    },
    frames: updatedFrames,
    selectedFrameId: candidateSelection,
    undoStack: [...state.undoStack, entry],
    redoStack: state.redoStack.slice(0, -1),
  };
}
