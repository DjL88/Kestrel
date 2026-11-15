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
      currTs - prevTs <= maxGapMs
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
    if (frame.removedAt) continue;
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
  ratingFilter?: RatingFilter | null
): PhotoFrame[] {
  const query = searchQuery.trim().toLowerCase();
  return frames.filter((frame) => {
    if (frame.removedAt) return false;
    if (filter !== 'all' && frame.decision !== filter) {
      return false;
    }
    if (!matchesRating(frame, ratingFilter)) return false;
    if (!query) return true;
    const haystack = [
      frame.filename,
      frame.exif.camera ?? '',
      frame.exif.lens ?? '',
      frame.demoVariant?.demoSceneLabel ?? '',
      ...(frame.subjectNames ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function stepSelection(
  visibleFrames: readonly PhotoFrame[],
  currentId: string | null,
  delta: number
): string | null {
  if (visibleFrames.length === 0) return null;
  if (!currentId) return visibleFrames[0].id;
  const idx = visibleFrames.findIndex((f) => f.id === currentId);
  if (idx === -1) return visibleFrames[0].id;
  const nextIdx = Math.max(0, Math.min(visibleFrames.length - 1, idx + delta));
  return visibleFrames[nextIdx].id;
}

export function getDefaultComparePair(
  frames: readonly PhotoFrame[],
  activeId: string | null
): { leftId: string | null; rightId: string | null } {
  if (frames.length === 0) return { leftId: null, rightId: null };
  const idx = activeId ? frames.findIndex((f) => f.id === activeId) : 0;
  const safeIdx = idx === -1 ? 0 : idx;
  const left = frames[safeIdx];

  if (frames.length === 1) {
    return { leftId: left.id, rightId: left.id };
  }

  // Prefer the next frame in the same burst, else previous in same burst, else next frame overall.
  const nextFrame = frames[safeIdx + 1];
  const prevFrame = frames[safeIdx - 1];

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
    rightId: nextFrame ? nextFrame.id : prevFrame.id,
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

  const targetFrame = state.frames[targetIdx];
  const visibleBefore = filterFrames(state.frames, state.filter, state.searchQuery, state.ratingFilter);
  const visibleIdx = visibleBefore.findIndex((f) => f.id === frameId);

  const shouldAdvance = options?.allowAdvance ?? state.autoAdvance;

  let nextSelectedId = state.selectedFrameId;
  if (shouldAdvance && state.selectedFrameId === frameId) {
    if (visibleIdx !== -1 && visibleIdx + 1 < visibleBefore.length) {
      nextSelectedId = visibleBefore[visibleIdx + 1].id;
    } else if (visibleIdx > 0 && state.filter !== 'all' && nextDecision !== state.filter) {
      // Last item in a filtered bucket removed by state change -> move to previous visible
      nextSelectedId = visibleBefore[visibleIdx - 1].id;
    } else if (targetIdx + 1 < state.frames.length && state.filter === 'all') {
      nextSelectedId = state.frames[targetIdx + 1].id;
    }
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
  const visibleAfter = filterFrames(updatedFrames, state.filter, state.searchQuery, state.ratingFilter);
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
  const byId = new Map(requested.map((result) => [result.frameId, result.decision]));
  const batch: NonNullable<CullingState['undoStack'][number]['batch']> = [];
  const frames = state.frames.map((frame) => {
    const decision = byId.get(frame.id);
    if (!decision || frame.removedAt || frame.decision !== 'unreviewed' || frame.isDemo || frame.virtualCopy) return frame;
    batch.push({ frameId: frame.id, prevDecision: frame.decision, nextDecision: decision });
    return { ...frame, decision };
  });
  if (!batch.length) return state;
  const visible = filterFrames(frames, state.filter, state.searchQuery, state.ratingFilter);
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

/** Take photos that are already in Trash out of the library. Files on disk are never touched, and Restore reverses it. */
export function removeFromLibrary(state: CullingState, frameIds: string[]): CullingState {
  const ids = new Set(frameIds);
  const targets = state.frames.filter((frame) => ids.has(frame.id) && frame.decision === 'reject' && !frame.removedAt);
  if (!targets.length) return state;
  const removing = new Set(targets.map((frame) => frame.id));
  const visibleBefore = filterFrames(state.frames, state.filter, state.searchQuery, state.ratingFilter);
  const firstIndex = visibleBefore.findIndex((frame) => removing.has(frame.id));
  const frames = state.frames.map((frame) => removing.has(frame.id) ? { ...frame, removedAt: Date.now() } : frame);
  const visibleAfter = filterFrames(frames, state.filter, state.searchQuery, state.ratingFilter);
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
  return frames.filter((frame) => frame.removedAt).sort((a, b) => (b.removedAt ?? 0) - (a.removedAt ?? 0));
}

/** Bring removed photos back. They return to Trash so nothing reappears among Keepers by surprise. */
export function restoreRemoved(state: CullingState, frameIds: string[]): CullingState {
  const ids = new Set(frameIds);
  if (!state.frames.some((frame) => ids.has(frame.id) && frame.removedAt)) return state;
  const frames = state.frames.map((frame) => {
    if (!ids.has(frame.id) || !frame.removedAt) return frame;
    const { removedAt: _removedAt, ...kept } = frame;
    return kept;
  });
  return { ...state, frames, shoot: { ...state.shoot, lastUpdatedAt: Date.now() } };
}

export function undoDecision(state: CullingState): CullingState {
  if (state.undoStack.length === 0) return state;
  const entry = state.undoStack[state.undoStack.length - 1];
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
  const updatedFrames = restoreFlags(state, entry, 'nextDecision');

  const visibleAfter = filterFrames(updatedFrames, state.filter, state.searchQuery, state.ratingFilter);
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
