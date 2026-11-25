import { decodeVector } from './speciesMatch';
import { LOGIT_SCALE, type RouteResult } from './subjectRouter';
import type { MarkingFormat } from './aircraftRegistration';
import type { RegisterSource } from './aircraftRegister';

/**
 * Vehicle and aircraft recognition, step 1: what kind of vehicle a photo shows (a car, a helicopter, a military jet…) and,
 * from a curated list, which make or type it probably is. It reads the SAME picture embedding the category gate already
 * made with CLIP ViT-B/32, so no other model runs and nothing leaves the device.
 *
 * Honest by construction: a picture is only read as a vehicle when the gate says it is mostly a vehicle; a kind is only
 * named when it clearly beats the others; a type only when it clearly beats the other types of that kind. Below that the
 * reading says "Aircraft, type unknown" (or "Military jet, type unknown"), and a type is always worded "probably". Never
 * reads or stores a number plate: CLIP sees shapes, and nothing here reads text.
 *
 * Pure and deterministic. Only ids are stored on the photo; the words people see come from `src/i18n/areas/vehicles`.
 */
export type VehicleFamily = 'air' | 'road' | 'rail' | 'water';
export const VEHICLE_FAMILIES: readonly VehicleFamily[] = ['air', 'road', 'rail', 'water'];

export interface VehicleKind {
  id: string;
  family: VehicleFamily;
  /** A vehicle the app does not tag (a bicycle, a tractor). Listed so such pictures are not forced onto a real kind. */
  decoy?: boolean;
  prompts: string[];
}
export interface VehicleType { id: string; kind: string; name: string; prompts: string[] }
export interface VehicleLabels { version: number; families: VehicleFamily[]; kinds: VehicleKind[]; types: VehicleType[] }
export interface VehicleVectorFile {
  dim: number;
  labelsVersion: number;
  kinds: Record<string, { v: string; scale: number }>;
  types: Record<string, { v: string; scale: number }>;
}
export interface VehicleVectors { kinds: Float32Array[]; types: Float32Array[] }

/**
 * Measured on 25 Nov 2026 with the app's own CLIP image model on 232 public-domain and Creative Commons photographs from
 * Wikimedia Commons, 31 kinds and types, never committed (tools/subject-router/vehicle_calibration_*.py re-runs it).
 * Thresholds were chosen on that same set, so treat them as a first measurement, not a proof:
 * - kind at 0.6 / 0.3: named on 119 of 232 photos, right on 114 (96%); the misses were Chinooks read as military transport,
 *   a museum Typhoon read as a light aircraft and an intercity train read as a tram;
 * - family ("Aircraft, type unknown") at 0.75: 76 photos, none wrong;
 * - type: CLIP alone is weak at telling types apart (51 of 163 right as a first guess). At 0.55 / 0.25 a named type was right
 *   on only 1 of 6 photos whose kind was clear (it leans to "Voyager" for every big grey aircraft); at 0.75 / 0.5 no wrong
 *   type was named, and in practice almost none is. Exact types come from a readable registration (step 2), not from here.
 * Re-measure whenever labels.json changes.
 */
export const VEHICLE_THRESHOLDS = {
  /** How much of the gate's probability must sit on vehicle categories before a picture is read as a vehicle at all. */
  gateMass: 0.6,
  kindProbability: 0.6,
  kindMargin: 0.3,
  /** Enough to say "Aircraft" when no single kind of aircraft is clear. */
  familyProbability: 0.75,
  typeProbability: 0.75,
  typeMargin: 0.5,
} as const;
export type VehicleThresholds = { [K in keyof typeof VEHICLE_THRESHOLDS]: number };

/** Where a reading came from. 'clip' is a look-alike guess; later steps add the registration lookup and the person. */
export type VehicleSource = 'clip' | 'person';

/** What is kept on a photo. Ids only, so the words follow the person's language. */
export interface VehicleReading {
  schema: 1;
  family: VehicleFamily;
  /** Absent when no single kind was clear ("Aircraft, type unknown"). */
  kind?: string;
  /** Absent when no type was clear, or the kind has no type list. Always "probably" while `source` is 'clip'. */
  type?: string;
  source: VehicleSource;
  /** Which label list made it, so a reading from an older list can be redone. */
  labelsVersion: number;
  /** Rounded to two places, for the "what was measured" detail only. */
  kindProbability?: number;
  typeProbability?: number;
  /** A registration or military serial read from the aircraft itself (step 2). Never set for a road vehicle. */
  marking?: { value: string; format: MarkingFormat; confidence: number };
  /** What an offline register says about that marking. `exact` is a register record; otherwise a serial block, "probably". */
  registered?: { type: string; operator?: string; register: RegisterSource; exact: boolean };
}

/** The committed vectors (src/assets/vehicle/vectors.json), in label order. Throws on any mismatch. */
export function vehicleVectors(file: VehicleVectorFile, labels: VehicleLabels): VehicleVectors {
  if (file.labelsVersion !== labels.version) throw new RangeError('The vehicle vectors were made from a different label list.');
  const read = (table: Record<string, { v: string; scale: number }>, id: string) => {
    const entry = table[id];
    if (!entry) throw new RangeError(`No vector for vehicle label ${id}.`);
    const vector = decodeVector({ vector: entry.v, scale: entry.scale });
    if (vector.length !== file.dim) throw new RangeError(`Vehicle label ${id} has ${vector.length} numbers, not ${file.dim}.`);
    return vector;
  };
  return { kinds: labels.kinds.map((kind) => read(file.kinds, kind.id)), types: labels.types.map((entry) => read(file.types, entry.id)) };
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : 0;
}

/** Softmax at CLIP's scale, most likely first. */
function rank(embedding: ArrayLike<number>, vectors: readonly ArrayLike<number>[]): { index: number; probability: number }[] {
  const logits = vectors.map((vector) => LOGIT_SCALE * cosine(embedding, vector));
  const top = Math.max(...logits);
  const weights = logits.map((value) => Math.exp(value - top));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight, index) => ({ index, probability: weight / total })).sort((a, b) => b.probability - a.probability);
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Read one picture. `embedding` is the gate's CLIP picture embedding and `route` the gate's answer for it; with no route
 * (the gate could not run) nothing is read. Returns null when the picture is not clearly a vehicle we tag.
 */
export function readVehicle(
  embedding: ArrayLike<number>, route: RouteResult | null, labels: VehicleLabels, vectors: VehicleVectors,
  thresholds: VehicleThresholds = VEHICLE_THRESHOLDS,
): VehicleReading | null {
  if (!route || !(route.vehicleProbability >= thresholds.gateMass)) return null;
  if (!embedding.length || !Array.from(embedding).every(Number.isFinite)) return null;
  if (vectors.kinds.length !== labels.kinds.length || vectors.types.length !== labels.types.length) throw new RangeError('One vector per vehicle label.');
  const kinds = rank(embedding, vectors.kinds);
  const best = kinds[0];
  const bestKind = labels.kinds[best.index];
  const margin = best.probability - (kinds[1]?.probability ?? 0);
  if (bestKind.decoy && best.probability >= thresholds.kindProbability) return null; // a bicycle or tractor: not tagged
  const clearKind = !bestKind.decoy && best.probability >= thresholds.kindProbability && margin >= thresholds.kindMargin;
  const familyMass = (family: VehicleFamily) => kinds.filter((entry) => !labels.kinds[entry.index].decoy && labels.kinds[entry.index].family === family)
    .reduce((sum, entry) => sum + entry.probability, 0);
  const family = clearKind ? bestKind.family : VEHICLE_FAMILIES.find((candidate) => familyMass(candidate) >= thresholds.familyProbability);
  if (!family) return null; // unknown stays unknown
  const reading: VehicleReading = { schema: 1, family, source: 'clip', labelsVersion: labels.version };
  if (!clearKind) return reading;
  reading.kind = bestKind.id;
  reading.kindProbability = round(best.probability);
  const candidates = labels.types.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === bestKind.id);
  if (candidates.length < 2) return reading;
  const types = rank(embedding, candidates.map(({ index }) => vectors.types[index]));
  const typeMargin = types[0].probability - (types[1]?.probability ?? 0);
  if (types[0].probability >= thresholds.typeProbability && typeMargin >= thresholds.typeMargin) {
    reading.type = candidates[types[0].index].entry.id;
    reading.typeProbability = round(types[0].probability);
  }
  return reading;
}

/** Whether a kind has a type list, so "type unknown" means something for it. */
export function kindHasTypes(labels: VehicleLabels, kind: string): boolean {
  return labels.types.filter((entry) => entry.kind === kind).length >= 2;
}

/** A stored reading, checked; anything malformed or from an unknown label is ignored, never shown. */
export function validVehicleReading(value: unknown, labels: VehicleLabels): VehicleReading | null {
  if (!value || typeof value !== 'object') return null;
  const reading = value as Partial<VehicleReading>;
  if (reading.schema !== 1 || !VEHICLE_FAMILIES.includes(reading.family as VehicleFamily)) return null;
  if (reading.source !== 'clip' && reading.source !== 'person') return null;
  const kind = reading.kind === undefined ? undefined : labels.kinds.find((entry) => entry.id === reading.kind && !entry.decoy);
  if (reading.kind !== undefined && (!kind || kind.family !== reading.family)) return null;
  if (reading.type !== undefined && !labels.types.some((entry) => entry.id === reading.type && entry.kind === reading.kind)) return null;
  const marking = reading.marking;
  if (marking !== undefined && (reading.family !== 'air' || !marking || typeof marking.value !== 'string' || !/^[A-Z0-9-]{4,8}$/.test(marking.value) ||
    !['uk-civil', 'irish-civil', 'us-civil', 'uk-military'].includes(marking.format) || !Number.isFinite(marking.confidence))) return null;
  const registered = reading.registered;
  if (registered !== undefined && (!marking || !registered || typeof registered.type !== 'string' || !registered.type.trim() ||
    (registered.operator !== undefined && typeof registered.operator !== 'string') ||
    !['faa', 'uk-military-blocks'].includes(registered.register) || typeof registered.exact !== 'boolean')) return null;
  return reading as VehicleReading;
}

export interface VehicleWords {
  families: Record<VehicleFamily, string>;
  kinds: Record<string, string>;
  probably: (what: string) => string;
  typeUnknown: (what: string) => string;
  withType: (kind: string, type: string) => string;
  /** A marking read from the aircraft that no register here covers: "Military jet, marked ZK999". */
  marked: (what: string, marking: string) => string;
  /** An exact register record: "N172SP: CESSNA 172S (FAA register)". */
  registered: (marking: string, type: string) => string;
  operatedBy: (what: string, operator: string) => string;
}

/**
 * The plain-language label for a reading: "Military jet: Eurofighter Typhoon (probably)", "Military jet, type unknown",
 * "Aircraft, type unknown", "Bus (probably)". A person's own choice is shown without "probably".
 */
export function vehicleLabel(reading: VehicleReading, labels: VehicleLabels, words: VehicleWords): string {
  const base = kindLabel(reading, labels, words);
  const { marking, registered } = reading;
  if (!marking || reading.source === 'person') return base;
  if (registered?.exact) {
    const text = words.registered(marking.value, registered.type);
    return registered.operator ? words.operatedBy(text, registered.operator) : text;
  }
  if (registered) return words.probably(words.withType(marking.value, registered.type));
  return words.marked(base, marking.value);
}

function kindLabel(reading: VehicleReading, labels: VehicleLabels, words: VehicleWords): string {
  const sure = reading.source === 'person';
  const hedge = (text: string) => (sure ? text : words.probably(text));
  if (!reading.kind) return words.typeUnknown(words.families[reading.family]);
  const kindWord = words.kinds[reading.kind] ?? reading.kind;
  const type = reading.type ? labels.types.find((entry) => entry.id === reading.type) : undefined;
  if (type) return hedge(words.withType(kindWord, type.name));
  if (kindHasTypes(labels, reading.kind) && !sure) return words.typeUnknown(kindWord);
  return hedge(kindWord);
}

/** The words a photo can be found by: in the person's language and in English, plus the type's own name. */
export function vehicleSearchWords(reading: VehicleReading, labels: VehicleLabels, words: readonly VehicleWords[]): string[] {
  const out = new Set<string>();
  for (const set of words) {
    out.add(set.families[reading.family]);
    if (reading.kind && set.kinds[reading.kind]) out.add(set.kinds[reading.kind]);
  }
  const type = reading.type ? labels.types.find((entry) => entry.id === reading.type) : undefined;
  if (type) out.add(type.name);
  if (reading.marking) out.add(reading.marking.value).add(reading.marking.value.replace(/-/g, ''));
  if (reading.registered) { out.add(reading.registered.type); if (reading.registered.operator) out.add(reading.registered.operator); }
  return [...out].filter(Boolean);
}

/** How sure the recogniser must be before a line of text is treated as a marking at all. */
export const MARKING_CONFIDENCE = 0.9;

/**
 * Add what was read from the aircraft to its reading. Only an aircraft reading is ever changed. Among the lines read, a
 * marking a register knows wins; then the surest valid marking. A register record that contradicts the picture's family
 * cannot occur (every record is an aircraft), but a serial block must agree with the picture's kind (see lookUpMarking).
 */
export function withMarking(
  reading: VehicleReading,
  lines: readonly { text: string; confidence: number }[],
  find: (text: string) => { value: string; format: MarkingFormat }[],
  lookUp: (marking: { value: string; format: MarkingFormat }) => VehicleReading['registered'] | null,
): VehicleReading {
  if (reading.family !== 'air') return reading;
  const candidates = lines.filter((line) => line.confidence >= MARKING_CONFIDENCE)
    .flatMap((line) => find(line.text).map((marking) => ({ ...marking, confidence: Math.round(line.confidence * 100) / 100 })))
    .sort((a, b) => b.confidence - a.confidence);
  if (!candidates.length) return reading;
  for (const marking of candidates) {
    const registered = lookUp(marking);
    if (registered) return { ...reading, marking, registered };
  }
  return { ...reading, marking: candidates[0] };
}
