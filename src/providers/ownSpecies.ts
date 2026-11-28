import { classifyOwnSpecies, parseOwnSpeciesHead, type OwnSpeciesHead } from '../core/ownSpeciesModel';
import { previewOn } from '../core/previewFeatures';
import type { SpeciesGuess } from '../core/speciesPalette';
import { decodeEmbedding } from '../core/visualSimilarity';
import { embedPicture } from './visualEmbedder';

/**
 * Species from InFlight's own small head on the shared DINOv2 embedding (src/core/ownSpeciesModel.ts). Off unless this
 * device's "Own species model" preview switch is on. Never throws: any failure means "no species".
 */
let head: Promise<OwnSpeciesHead | null> | null = null;

function loadHead(): Promise<OwnSpeciesHead | null> {
  head ??= import('../assets/species-own/head.json').then((module) => parseOwnSpeciesHead(module.default)).catch(() => null);
  return head;
}

export async function identifyOwnSubject(picture: HTMLCanvasElement): Promise<SpeciesGuess | null> {
  try {
    if (!previewOn('ownSpecies')) return null;
    const loaded = await loadHead();
    if (!loaded) return null;
    const embedding = decodeEmbedding((await embedPicture(picture)) ?? undefined);
    return embedding ? classifyOwnSpecies(embedding, loaded)?.guess ?? null : null;
  } catch { return null; }
}
