/**
 * A portable camera/lens identity catalogue for future optional updates.
 * This is metadata ONLY. A camera entry does not enable decoding or invent a
 * colour or lens correction profile. Network, signatures and persistence live
 * at separate trusted boundaries.
 */
export type EquipmentMaker = 'Canon' | 'Nikon' | 'Sony' | 'Other';
export type EquipmentKind = 'camera' | 'lens';
export type EquipmentSource = 'lensfun' | 'manufacturer' | 'verified-test';

export interface EquipmentEntry {
  id: string;
  kind: EquipmentKind;
  maker: EquipmentMaker;
  model: string;
  aliases: string[];
  source: EquipmentSource;
  /** Human-readable provenance; never loaded as an executable script. */
  sourceUrl: string;
}
export interface EquipmentCatalogue {
  schema: 1;
  revision: number;
  entries: EquipmentEntry[];
}

const MAX_ENTRIES = 5000;
const MAX_ALIASES = 12;
const MAX_LABEL = 128;
const MAX_URL = 500;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MAKERS: EquipmentMaker[] = ['Canon', 'Nikon', 'Sony', 'Other'];
const SOURCES: EquipmentSource[] = ['lensfun', 'manufacturer', 'verified-test'];
const KINDS: EquipmentKind[] = ['camera', 'lens'];

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function label(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_LABEL &&
    value === value.trim() && !/[\u0000-\u001f\u007f<>]/.test(value);
}
function sourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_URL) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
function onlyKeys(value: Record<string, unknown>, fields: string[]): boolean {
  return Object.keys(value).every((key) => fields.includes(key));
}

/** Reject oversized, ambiguous or malformed feeds; never partly apply them. */
export function parseEquipmentCatalogue(input: unknown): EquipmentCatalogue | null {
  if (!record(input) || !onlyKeys(input, ['schema', 'revision', 'entries']) ||
      input.schema !== 1 || !Number.isSafeInteger(input.revision) || (input.revision as number) < 1 ||
      !Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES) return null;

  const ids = new Set<string>();
  const entries: EquipmentEntry[] = [];
  for (const candidate of input.entries) {
    if (!record(candidate) || !onlyKeys(candidate, ['id', 'kind', 'maker', 'model', 'aliases', 'source', 'sourceUrl']) ||
        typeof candidate.id !== 'string' || !SAFE_ID.test(candidate.id) || ids.has(candidate.id) ||
        !KINDS.includes(candidate.kind as EquipmentKind) ||
        !MAKERS.includes(candidate.maker as EquipmentMaker) ||
        !SOURCES.includes(candidate.source as EquipmentSource) ||
        !label(candidate.model) || !sourceUrl(candidate.sourceUrl) ||
        !Array.isArray(candidate.aliases) || candidate.aliases.length > MAX_ALIASES ||
        !candidate.aliases.every(label)) return null;
    const names = [candidate.model, ...candidate.aliases].map((value: string) => value.toLocaleLowerCase('en-US'));
    if (new Set(names).size !== names.length) return null;
    ids.add(candidate.id);
    entries.push({
      id: candidate.id,
      kind: candidate.kind as EquipmentKind,
      maker: candidate.maker as EquipmentMaker,
      model: candidate.model,
      aliases: [...candidate.aliases] as string[],
      source: candidate.source as EquipmentSource,
      sourceUrl: candidate.sourceUrl,
    });
  }
  return { schema: 1, revision: input.revision as number, entries };
}

/**
 * Monotonic revisions prevent an older valid file from replacing newer data.
 * Caller MUST verify the signed manifest, SHA-256 and byte count beforehand.
 */
export function selectEquipmentUpdate(
  existing: EquipmentCatalogue,
  incoming: unknown,
): EquipmentCatalogue | null {
  const next = parseEquipmentCatalogue(incoming);
  return next && next.revision > existing.revision ? next : null;
}

/** Avoid accidentally confusing an official product name with RAW support. */
export function findEquipmentLabel(
  catalogue: EquipmentCatalogue,
  kind: EquipmentKind,
  maker: EquipmentMaker,
  modelOrAlias: string,
): string | null {
  const name = modelOrAlias.trim().toLocaleLowerCase('en-US');
  if (!name) return null;
  for (const entry of catalogue.entries) {
    if (entry.kind === kind && entry.maker === maker &&
      [entry.model, ...entry.aliases].some((candidate) => candidate.toLocaleLowerCase('en-US') === name)) {
      return entry.model;
    }
  }
  return null;
}
