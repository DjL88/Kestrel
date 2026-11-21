import { decodeVector } from './speciesMatch';
import { speciesGate, type RouteResult, type SpeciesGate, type SubjectCategory } from './subjectRouter';
import type { SubjectKind } from './subjectTags';

/**
 * The category gate, wired: what a general image-and-text model (CLIP ViT-B/32) says a photo shows decides whether the
 * species step may name an animal at all, and lets an unclassified photo that is clearly an animal be treated as
 * wildlife. A helicopter can then never become an osprey, and a fresh bird import gets species suggestions without
 * anyone marking it Wildlife first. Unknown stays unknown; a kind the person chose always wins.
 */
// Optional chaining: outside Vite (unit tests under Node) there is no import.meta.env.
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
export const GATE_MODEL = {
  /** In public/models, so it is part of every build; the app fetches it from its own files only. Tests use a stand-in. */
  url: env?.VITE_GATE_MODEL_URL ?? '/models/clip-vit-b32-vision-uint8.onnx',
  sha256: env?.VITE_GATE_MODEL_SHA256 ?? 'b95448754a6ae56964ec80c570c80bb9863787ee85f51b664abed8c0e5f22a7a',
  bytes: Number(env?.VITE_GATE_MODEL_BYTES ?? 88648915),
  size: 224,
  /** Kept with the species model in the browser, so one opt-in download and one Remove cover both. */
  cache: 'kestrel-species-v1',
} as const;

/** A doubtful animal/aircraft category can be shown for review, but must never auto-name a species. */
export function permitsAutomaticSpeciesTag(species: SpeciesGate): boolean {
  return species === 'allow';
}

export interface GateOutcome {
  /** 'wildlife' only when the photo had no kind and the gate is confident it is an animal the species list covers. */
  kind?: Extract<SubjectKind, 'wildlife'>;
  species: SpeciesGate;
}

/**
 * What the gate allows for one photo. `route` is null when there is no category evidence (the checker couldn't run):
 * then no automatic animal name is allowed, even on a photo marked Wildlife (from #439). The checker ships with every
 * build that offers species names, so this only bites when it fails.
 */
export function gateOutcome(route: RouteResult | null, currentKind: SubjectKind | undefined): GateOutcome {
  const species = route ? speciesGate(route) : 'block';
  const clearlyAnimal = !!route?.confident && route.category?.group === 'animal' && species === 'allow';
  return !currentKind && clearlyAnimal ? { kind: 'wildlife', species } : { species };
}

/** The committed category vectors (src/assets/subject/vectors.json), in taxonomy order. Throws on any mismatch. */
export function gateVectors(file: { dim: number; vectors: Record<string, { v: string; scale: number }> }, categories: readonly SubjectCategory[]): Float32Array[] {
  return categories.map((category) => {
    const entry = file.vectors[category.id];
    if (!entry) throw new RangeError(`No vector for category ${category.id}.`);
    const vector = decodeVector({ vector: entry.v, scale: entry.scale });
    if (vector.length !== file.dim) throw new RangeError(`Category ${category.id} has ${vector.length} numbers, not ${file.dim}.`);
    return vector;
  });
}
