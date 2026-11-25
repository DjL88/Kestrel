import { useCallback, useEffect, useRef, useState } from 'react';
import { mergePhotoTags, type PhotoTag } from '../../core/photoTags';
import { PLACES_LANE } from '../../core/places';
import { PLACES_REVISION, SCENE_FACETS, SCENE_LANE, sceneRevision, sceneTagCandidates, sceneTagWork } from '../../core/sceneTags';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { gateAvailable } from '../../providers/categoryGate';
import { pictureForAnalysis } from '../../providers/pictureForAnalysis';
import { placeTagsFor, sceneTagsFor } from '../../providers/sceneTagger';

interface Options {
  projectId: string;
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider | null;
  /** True while the editor is open and no import is running. The pass stops whenever this goes false. */
  active: boolean;
  onScreen: string | null;
  /** Apply a change to one photo's frame (the store of tags). Must keep the person's own changes since. */
  onTagged: (frameId: string, update: (frame: PhotoFrame) => PhotoFrame) => void;
}

/**
 * Tags photos quietly in the background on this device: places from GPS (GeoNames, offline), light from the sun's
 * position, and light, weather, style and genre from the image model with measured thresholds. Never changes a
 * decision, rating or edit; a tag the person removed is never put back.
 */
export function useSceneTags({ projectId, frames, provider, active, onScreen, onTagged }: Options) {
  const latest = useRef({ projectId, frames, provider, active, onScreen, onTagged });
  latest.current = { projectId, frames, provider, active, onScreen, onTagged };
  const running = useRef(false);
  const skipped = useRef(new Set<string>());
  const [modelAvailable, setModelAvailable] = useState(false);
  useEffect(() => { void gateAvailable().then(setModelAvailable, () => setModelAvailable(false)); }, [active]);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const { projectId: currentId, frames: current, provider: store, onScreen: focus } = latest.current;
        const stillCurrent = () => latest.current.active && latest.current.projectId === currentId;
        if (!stillCurrent() || !store) break;
        const frame = sceneTagCandidates(current, focus, modelAvailable, skipped.current)[0];
        if (!frame) break;
        skipped.current.add(frame.id);
        const work = sceneTagWork(frame, modelAvailable);
        let places: PhotoTag[] | null = null;
        let scene: { tags: PhotoTag[]; withModel: boolean } | null = null;
        if (work.places) places = await placeTagsFor(frame).catch(() => null);
        if (work.scene) {
          const picture = await pictureForAnalysis(store, frame).catch(() => null);
          if (picture) scene = await sceneTagsFor(frame, picture).catch(() => null);
        }
        if (!stillCurrent()) break;
        const at = Date.now();
        latest.current.onTagged(frame.id, (live) => {
          // Tags worked out for an older file at the same place are not written.
          if (live.stableKey !== frame.stableKey || live.originalSha256 !== frame.originalSha256) return live;
          let next = live;
          if (places) next = mergePhotoTags(next, PLACES_LANE, ['place', 'landmark'], places, PLACES_REVISION, at);
          if (scene) next = mergePhotoTags(next, SCENE_LANE, SCENE_FACETS, scene.tags, sceneRevision(scene.withModel), at);
          return next;
        });
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      }
    } finally {
      running.current = false;
    }
  }, [modelAvailable]);

  useEffect(() => { skipped.current.clear(); }, [projectId, modelAvailable]);
  const waiting = sceneTagCandidates(frames, onScreen, modelAvailable, skipped.current).length;
  useEffect(() => {
    if (active && provider && waiting > 0 && !running.current) void run();
  }, [active, provider, waiting, run]);
}
