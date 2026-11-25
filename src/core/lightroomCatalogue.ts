/**
 * Read a Lightroom Classic catalogue (.lrcat) without changing it: for every photo, where it is, its star rating,
 * pick or reject flag, keywords, the ordinary collections it is in, and its basic develop settings.
 *
 * The catalogue is an SQLite database. It is read through `sqliteRead`, which has no write path, so neither the
 * catalogue nor any photo can be changed. Previews and pixels are never read. The table layout follows Lightroom
 * Classic's catalogue (the same one `tools/lightroom/read_lrcat.py` reads); anything missing is reported by name,
 * never guessed.
 */
import { openSqliteFile, SqliteFile, SqliteReadError, type SqlRow } from './sqliteRead';

/** Develop settings InFlight can carry over, in Lightroom's own units (Process Version 2012 and later). */
export interface LightroomDevelop {
  exposure?: number; // EV, -5 to 5
  contrast?: number; highlights?: number; shadows?: number; whites?: number; blacks?: number; // -100 to 100
  clarity?: number; texture?: number; dehaze?: number; vibrance?: number; saturation?: number; // -100 to 100
  luminanceNoise?: number; // 0 to 100
  vignette?: number; // post-crop vignette, -100 to 100
  grain?: number; grainSize?: number; // 0 to 100
  monochrome?: boolean;
  /** Settings InFlight does not carry over, so the person can be told plainly. */
  notCarried: Array<'crop' | 'white-balance' | 'local' | 'old-process'>;
}

export interface LightroomPhoto {
  id: number;
  /** Full path as Lightroom stores it, with forward slashes. */
  path: string;
  /** File name with extension, as on disk. */
  filename: string;
  captureTime?: string;
  rating?: number;
  flag: 'pick' | 'reject' | null;
  keywords: string[];
  collections: string[];
  develop: LightroomDevelop | null;
  virtualCopy: boolean;
}

export type CatalogueFailure = 'not-catalogue' | 'layout' | 'too-large' | 'unreadable';
export class CatalogueReadError extends Error {
  constructor(readonly reason: CatalogueFailure, readonly detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'CatalogueReadError';
  }
}

const MAX_PHOTOS = 500_000;
const NEEDED: Record<string, string[]> = {
  Adobe_images: ['id_local', 'rootFile'],
  AgLibraryFile: ['id_local', 'folder', 'baseName', 'extension'],
  AgLibraryFolder: ['id_local', 'rootFolder', 'pathFromRoot'],
  AgLibraryRootFolder: ['id_local', 'absolutePath'],
};

export async function readLightroomCatalogue(file: Blob): Promise<LightroomPhoto[]> {
  try {
    return await readCatalogue(await openSqliteFile(file));
  } catch (error) {
    throw asCatalogueError(error);
  }
}

export async function readCatalogue(db: SqliteFile): Promise<LightroomPhoto[]> {
  try {
    return await readFrom(db);
  } catch (error) {
    throw asCatalogueError(error);
  }
}

function asCatalogueError(error: unknown): CatalogueReadError {
  if (error instanceof CatalogueReadError) return error;
  if (error instanceof SqliteReadError) {
    if (error.reason === 'not-sqlite') return new CatalogueReadError('not-catalogue');
    if (error.reason === 'too-large') return new CatalogueReadError('too-large');
    return new CatalogueReadError('unreadable', error.message);
  }
  return new CatalogueReadError('unreadable');
}

async function readFrom(db: SqliteFile): Promise<LightroomPhoto[]> {
  const tables = await db.tables();
  if (!tables.has('Adobe_images') && !tables.has('AgLibraryFile')) throw new CatalogueReadError('not-catalogue');
  for (const [table, columns] of Object.entries(NEEDED)) {
    const have = tables.get(table)?.columns;
    if (!have) throw new CatalogueReadError('layout', `missing table ${table}`);
    const missing = columns.filter((column) => !have.includes(column));
    if (missing.length) throw new CatalogueReadError('layout', `${table} lacks ${missing.join(', ')}`);
  }

  const roots = await index(db, 'AgLibraryRootFolder', (row) => text(row.absolutePath));
  const folders = await index(db, 'AgLibraryFolder', (row) => ({ root: num(row.rootFolder), path: text(row.pathFromRoot) }));
  const files = await index(db, 'AgLibraryFile', (row) => ({
    folder: num(row.folder), base: text(row.baseName), extension: text(row.extension),
  }));

  const keywordNames = tables.has('AgLibraryKeyword') ? await index(db, 'AgLibraryKeyword', (row) => text(row.name)) : new Map();
  const keywordsOf = new Map<number, Set<string>>();
  if (tables.has('AgLibraryKeywordImage')) {
    for await (const row of db.rows('AgLibraryKeywordImage')) {
      const name = keywordNames.get(num(row.tag) ?? -1);
      const image = num(row.image);
      if (!name || image == null) continue;
      add(keywordsOf, image, name.trim());
    }
  }

  // Only ordinary collections hold photos directly; smart collections are rules and collection sets are folders of them.
  const collectionNames = tables.has('AgLibraryCollection')
    ? await index(db, 'AgLibraryCollection', (row) => {
      const kind = text(row.creationId);
      return kind && kind !== 'com.adobe.ag.library.collection' ? '' : text(row.name);
    })
    : new Map();
  const collectionsOf = new Map<number, Set<string>>();
  if (tables.has('AgLibraryCollectionImage')) {
    for await (const row of db.rows('AgLibraryCollectionImage')) {
      const name = collectionNames.get(num(row.collection) ?? -1);
      const image = num(row.image);
      if (!name || image == null) continue;
      add(collectionsOf, image, name.trim());
    }
  }

  const developOf = new Map<number, LightroomDevelop>();
  if (tables.get('Adobe_imageDevelopSettings')?.columns.includes('text')) {
    for await (const row of db.rows('Adobe_imageDevelopSettings')) {
      const image = num(row.image);
      const settings = text(row.text);
      if (image != null && settings) developOf.set(image, parseDevelopSettings(settings));
    }
  }

  const photos: LightroomPhoto[] = [];
  for await (const row of db.rows('Adobe_images')) {
    const id = num(row.id_local);
    const file = files.get(num(row.rootFile) ?? -1);
    if (id == null || !file?.base) continue;
    const folder = folders.get(file.folder ?? -1);
    const root = folder ? roots.get(folder.root ?? -1) : undefined;
    const filename = file.extension ? `${file.base}.${file.extension}` : file.base;
    if (photos.length >= MAX_PHOTOS) throw new CatalogueReadError('too-large');
    const pick = num(row.pick);
    const rating = num(row.rating);
    photos.push({
      id,
      path: `${(root ?? '').replace(/\\/g, '/')}${(folder?.path ?? '').replace(/\\/g, '/')}${filename}`,
      filename,
      captureTime: text(row.captureTime) || undefined,
      rating: rating != null && rating >= 1 && rating <= 5 ? Math.round(rating) : undefined,
      flag: pick === 1 ? 'pick' : pick === -1 ? 'reject' : null,
      keywords: [...(keywordsOf.get(id) ?? [])].sort(),
      collections: [...(collectionsOf.get(id) ?? [])].sort(),
      develop: developOf.get(id) ?? null,
      virtualCopy: row.masterImage != null && row.masterImage !== '' && num(row.masterImage) !== id,
    });
  }
  return photos;
}

async function index<T>(db: SqliteFile, table: string, pick: (row: SqlRow) => T): Promise<Map<number, T>> {
  const map = new Map<number, T>();
  for await (const row of db.rows(table)) {
    const id = num(row.id_local);
    if (id != null) map.set(id, pick(row));
  }
  return map;
}

function add(map: Map<number, Set<string>>, key: number, value: string) {
  if (!value) return;
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const text = (value: unknown): string => typeof value === 'string' ? value : '';

/** Only the characters directly inside the outer `s = { ... }`, so settings inside masks or curves never leak out. */
function topLevelText(settings: string): string {
  const kept: string[] = [];
  let depth = 0;
  let quoted = false;
  for (const char of settings) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '{') {
      depth++;
      if (depth > 1) kept.push(' ');
      continue;
    } else if (!quoted && char === '}') {
      depth--;
      continue;
    }
    if (depth === 1) kept.push(char);
  }
  return kept.join('');
}

const SCALAR = /([A-Za-z0-9_]+)\s*=\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|"[^"]*"|true|false)\s*(?:,|$)/gm;

/** Lightroom's develop settings text (a Lua table) to the settings InFlight can carry over. */
export function parseDevelopSettings(settings: string): LightroomDevelop {
  const found = new Map<string, number | string | boolean>();
  for (const [, key, raw] of topLevelText(settings).matchAll(SCALAR)) {
    found.set(key, raw === 'true' ? true : raw === 'false' ? false : raw.startsWith('"') ? raw.slice(1, -1) : Number(raw));
  }
  const n = (key: string, min: number, max: number) => {
    const value = found.get(key);
    return typeof value === 'number' && Number.isFinite(value) && value !== 0 ? Math.min(max, Math.max(min, value)) : undefined;
  };
  const notCarried: LightroomDevelop['notCarried'] = [];
  if (/MaskGroupBasedCorrections|RetouchInfo|PaintBasedCorrections|GradientBasedCorrections|CircularGradientBasedCorrections/.test(settings)) notCarried.push('local');
  if (found.get('HasCrop') === true || (n('CropAngle', -45, 45) ?? 0) !== 0) notCarried.push('crop');
  const balance = found.get('WhiteBalance');
  if (typeof balance === 'string' && balance !== 'As Shot') notCarried.push('white-balance');
  const version = String(found.get('ProcessVersion') ?? '');
  // Process Versions before 2012 use different sliders (Fill Light, Recovery); their numbers mean other things.
  if (version && Number(version) < 6.7) {
    notCarried.push('old-process');
    return { notCarried };
  }
  const develop: LightroomDevelop = {
    exposure: n('Exposure2012', -5, 5),
    contrast: n('Contrast2012', -100, 100),
    highlights: n('Highlights2012', -100, 100),
    shadows: n('Shadows2012', -100, 100),
    whites: n('Whites2012', -100, 100),
    blacks: n('Blacks2012', -100, 100),
    clarity: n('Clarity2012', -100, 100),
    texture: n('Texture', -100, 100),
    dehaze: n('Dehaze', -100, 100),
    vibrance: n('Vibrance', -100, 100),
    saturation: n('Saturation', -100, 100),
    luminanceNoise: n('LuminanceSmoothing', 0, 100),
    vignette: n('PostCropVignetteAmount', -100, 100),
    grain: n('GrainAmount', 0, 100),
    grainSize: n('GrainSize', 0, 100),
    monochrome: found.get('ConvertToGrayscale') === true || undefined,
    notCarried,
  };
  for (const key of Object.keys(develop) as (keyof LightroomDevelop)[]) if (develop[key] === undefined) delete develop[key];
  return develop;
}

/** True when the develop settings change anything InFlight carries over. */
export function hasCarriedDevelop(develop: LightroomDevelop | null): boolean {
  return !!develop && Object.keys(develop).some((key) => key !== 'notCarried');
}
