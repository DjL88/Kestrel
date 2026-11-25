/**
 * Lens profiles from the lensfun database (CC BY-SA 3.0), read on this device after the person chose to download it.
 * Pure: parse the XML, find the camera and lens a photo's EXIF names, and resolve one profile for its focal length and
 * aperture. The result is stored in the photo's recipe (LensCorrection.profile), so nothing here runs at render time.
 *
 * Units, from lensfun's own code (modifier.cpp): distortion is measured with r = 1 at half the shorter side of the
 * calibration frame, vignetting with r = 1 at its half-diagonal. Kestrel measures r = 1 at the half-diagonal of this
 * photo, so a distortion radius is multiplied by sqrt(Ac^2 + 1) * Cc / Ci and a vignetting radius by Cc / Ci (A: aspect
 * ratio, C: crop factor; c: calibration, i: this photo's camera).
 */
import type { LensProfile, LensProfileNote } from './lensCorrection';

export interface DbCamera { maker: string; makers: string[]; model: string; models: string[]; mount: string; crop: number }
export interface DistortionPoint { focal: number; model: 'ptlens' | 'poly3' | 'poly5'; k: number[] }
export interface VignettePoint { focal: number; aperture: number; distance: number; k: [number, number, number] }
export interface DbLens {
  maker: string;
  makers: string[];
  model: string;
  models: string[];
  mounts: string[];
  crop: number;
  aspect: number;
  distortion: DistortionPoint[];
  vignetting: VignettePoint[];
}
export interface LensDb { cameras: DbCamera[]; lenses: DbLens[]; mounts: Record<string, string[]> }

export const emptyLensDb = (): LensDb => ({ cameras: [], lenses: [], mounts: {} });

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]).replace(/\s+/g, ' ').trim();

/** Text of each <tag>, the plain one first and translated names (lang="…") after. */
function texts(block: string, tag: string): string[] {
  const plain: string[] = [], other: string[] = [];
  for (const m of block.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))) {
    const value = decode(m[2]);
    if (!value) continue;
    (m[1] && /lang=/.test(m[1]) ? other : plain).push(value);
  }
  return [...plain, ...other];
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-z0-9_]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

const num = (v: string | undefined) => (v === undefined || v.trim() === '' ? NaN : Number(v));

function aspectRatio(text: string | undefined): number {
  if (!text) return 1.5;
  const ratio = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(text);
  const value = ratio ? Number(ratio[1]) / Number(ratio[2]) : Number(text);
  return Number.isFinite(value) && value >= 1 && value <= 4 ? value : 1.5;
}

/** Reads one lensfun database file. Unknown or malformed entries are skipped, never guessed. */
export function parseLensfunXml(xml: string, into: LensDb = emptyLensDb()): LensDb {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of text.matchAll(/<mount>([\s\S]*?)<\/mount>/g)) {
    const [name] = texts(m[1], 'name');
    if (name) into.mounts[name] = [...(into.mounts[name] ?? []), ...texts(m[1], 'compat')];
  }
  for (const m of text.matchAll(/<camera>([\s\S]*?)<\/camera>/g)) {
    const makers = texts(m[1], 'maker'), models = texts(m[1], 'model'), [mount] = texts(m[1], 'mount');
    const crop = num(texts(m[1], 'cropfactor')[0]);
    if (!makers[0] || !models[0] || !mount || !(crop > 0)) continue;
    into.cameras.push({ maker: makers[0], makers, model: models[0], models, mount, crop });
  }
  for (const m of text.matchAll(/<lens>([\s\S]*?)<\/lens>/g)) {
    const body = m[1];
    const makers = texts(body, 'maker'), models = texts(body, 'model'), mounts = texts(body, 'mount');
    const crop = num(texts(body, 'cropfactor')[0]);
    if (!models[0] || !(crop > 0)) continue;
    const distortion: DistortionPoint[] = [], vignetting: VignettePoint[] = [];
    for (const d of body.matchAll(/<distortion\s[^>]*>/g)) {
      const a = attributes(d[0]), focal = num(a.focal);
      if (!(focal > 0)) continue;
      const k = a.model === 'ptlens' ? [num(a.a ?? '0'), num(a.b ?? '0'), num(a.c ?? '0')]
        : a.model === 'poly3' ? [num(a.k1 ?? '0')]
        : a.model === 'poly5' ? [num(a.k1 ?? '0'), num(a.k2 ?? '0')] : null;
      if (k && k.every(Number.isFinite)) distortion.push({ focal, model: a.model as DistortionPoint['model'], k });
    }
    for (const v of body.matchAll(/<vignetting\s[^>]*>/g)) {
      const a = attributes(v[0]);
      if (a.model !== 'pa') continue;
      const point = { focal: num(a.focal), aperture: num(a.aperture), distance: num(a.distance ?? '1000'), k: [num(a.k1 ?? '0'), num(a.k2 ?? '0'), num(a.k3 ?? '0')] as [number, number, number] };
      if (point.focal > 0 && point.aperture > 0 && point.distance > 0 && point.k.every(Number.isFinite)) vignetting.push(point);
    }
    if (!distortion.length && !vignetting.length) continue;
    into.lenses.push({ maker: makers[0] ?? '', makers, model: models[0], models, mounts, crop, aspect: aspectRatio(texts(body, 'aspect-ratio')[0]), distortion, vignetting });
  }
  return into;
}

// ---- matching -------------------------------------------------------------------------------------------------------

const lower = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const squash = (s: string) => lower(s).replace(/[^a-z0-9]+/g, '');
const words = (s: string) => lower(s).split(/[^a-z0-9]+/).filter(Boolean);

/** "Nikon Corporation" and "NIKON" both name Nikon: words that only say who made it. */
const MAKER_NOISE = new Set(['corporation', 'corp', 'co', 'ltd', 'inc', 'company', 'imaging', 'optical', 'digital', 'solutions', 'camera', 'cameras']);
const makerWords = (makers: string[]) => new Set(makers.flatMap(words).filter((w) => !MAKER_NOISE.has(w)));

/** The camera a photo's EXIF label ("NIKON Z 5", "Canon EOS R5", "SONY ILCE-7M3") names, or null. */
export function findCamera(db: LensDb, label: string | undefined): DbCamera | null {
  if (!label?.trim()) return null;
  const labelWords = words(label);
  for (const camera of db.cameras) {
    const strip = new Set([...makerWords(camera.makers), ...MAKER_NOISE]);
    const target = squash(labelWords.filter((w) => !strip.has(w)).join(' '));
    if (!target) continue;
    if (camera.models.some((model) => squash(words(model).filter((w) => !strip.has(w)).join(' ')) === target)) return camera;
  }
  return null;
}

interface LensKey { focal: string | null; aperture: string | null; rest: Set<string> }

const trimNumber = (s: string) => String(Number(s));

/** Focal range, maximum aperture and the remaining words of a lens name, so "EF24-105mm f/4L IS USM" and
 * "Canon EF 24-105mm f/4L IS USM" compare equal apart from the maker. */
function lensKey(name: string, makers: Set<string>): LensKey {
  let s = lower(name).replace(/,(\d)/g, '.$1');
  let focal: string | null = null, aperture: string | null = null;
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*mm/, (_, a: string, b?: string) => {
    focal = b ? `${trimNumber(a)}-${trimNumber(b)}` : trimNumber(a);
    return ' ';
  });
  s = s.replace(/(?:\bf\s*\/?|1\s*:\s*)(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/, (_, a: string, b?: string) => {
    aperture = b ? `${trimNumber(a)}-${trimNumber(b)}` : trimNumber(a);
    return ' ';
  });
  const rest = new Set(s.replace(/([a-z])(\d)|(\d)([a-z])/g, '$1$3 $2$4').split(/[^a-z0-9]+/).filter((w) => w && !makers.has(w)));
  return { focal, aperture, rest };
}

function similarity(a: LensKey, b: LensKey): number {
  if (!a.focal || a.focal !== b.focal) return 0;
  if (a.aperture && b.aperture && a.aperture !== b.aperture) return 0;
  let shared = 0;
  for (const w of a.rest) if (b.rest.has(w)) shared += 1;
  const union = a.rest.size + b.rest.size - shared;
  return union === 0 ? 1 : shared / union;
}

/** Lens mounts a camera with this mount can take, its own first. */
function compatibleMounts(db: LensDb, mount: string): Set<string> {
  return new Set([mount, ...(db.mounts[mount] ?? [])]);
}

/** The lens the EXIF names, or null when nothing in the database is a confident match. With the camera known, a lens
 * for its mount wins a tie; a compact's built-in lens is found from the camera alone. */
export function findLens(db: LensDb, lensName: string | undefined, camera: DbCamera | null): DbLens | null {
  const mounts = camera ? compatibleMounts(db, camera.mount) : null;
  if (!lensName?.trim()) {
    if (!camera) return null;
    return db.lenses.find((lens) => lens.mounts.includes(camera.mount) && lens.models.some((m) => /fixed lens/i.test(m))) ?? null;
  }
  let best: DbLens | null = null, bestScore = 0;
  for (const lens of db.lenses) {
    const strip = makerWords([...lens.makers, ...(camera?.makers ?? [])]);
    const wanted = lensKey(lensName, strip);
    const score = Math.max(...lens.models.map((model) => similarity(wanted, lensKey(model, strip))))
      + (mounts && lens.mounts.some((m) => mounts.has(m)) ? 0.01 : 0);
    if (score > bestScore) { best = lens; bestScore = score; }
  }
  return bestScore >= 0.6 ? best : null;
}

// ---- resolving one profile -------------------------------------------------------------------------------------------

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The two entries either side of x by key, or the nearest one twice when x is outside the measured range. */
function bracket<T>(items: T[], key: (item: T) => number, x: number): [T, T, number] {
  const sorted = [...items].sort((p, q) => key(p) - key(q));
  if (x <= key(sorted[0])) return [sorted[0], sorted[0], 0];
  const last = sorted[sorted.length - 1];
  if (x >= key(last)) return [last, last, 0];
  for (let i = 1; i < sorted.length; i += 1) {
    if (key(sorted[i]) >= x) {
      const lo = sorted[i - 1], hi = sorted[i];
      const span = key(hi) - key(lo);
      return [lo, hi, span ? (x - key(lo)) / span : 0];
    }
  }
  return [last, last, 0];
}

function distortionAt(points: DistortionPoint[], focal: number): DistortionPoint | null {
  if (!points.length) return null;
  const [lo, hi, t] = bracket(points, (p) => p.focal, focal);
  if (lo.model !== hi.model) return t < 0.5 ? lo : hi;
  return { focal, model: lo.model, k: lo.k.map((v, i) => lerp(v, hi.k[i], t)) };
}

/** Vignetting at one focal length: the farthest focus measured (EXIF rarely records distance), interpolated in stops of aperture. */
function vignettingAtFocal(points: VignettePoint[], aperture: number): [number, number, number] {
  const far = Math.max(...points.map((p) => p.distance));
  const atFar = points.filter((p) => p.distance === far);
  const [lo, hi, t] = bracket(atFar, (p) => Math.log2(p.aperture), Math.log2(aperture));
  return [0, 1, 2].map((i) => lerp(lo.k[i], hi.k[i], t)) as [number, number, number];
}

function vignettingAt(points: VignettePoint[], focal: number, aperture: number): [number, number, number] | null {
  if (!points.length) return null;
  const focals = [...new Set(points.map((p) => p.focal))];
  const [lo, hi, t] = bracket(focals, (f) => f, focal);
  const a = vignettingAtFocal(points.filter((p) => p.focal === lo), aperture);
  const b = vignettingAtFocal(points.filter((p) => p.focal === hi), aperture);
  return [0, 1, 2].map((i) => lerp(a[i], b[i], t)) as [number, number, number];
}

export interface PhotoLensFacts {
  camera?: string;
  lens?: string;
  focalLengthMm?: number;
  apertureF?: number;
  /** 35 mm equivalent focal length, when the camera recorded it: gives the crop factor of a camera not in the database. */
  focalLength35mm?: number;
}

export type LensProfileLookup =
  | { kind: 'found'; profile: LensProfile }
  | { kind: 'no-lens' }
  | { kind: 'not-found'; lens: string }
  | { kind: 'no-focal' };

const round = (v: number, places = 6) => Number(v.toFixed(places));

/** A profile for this photo, or why there is none. Never guesses a lens or a zoom position. */
export function resolveLensProfile(db: LensDb, facts: PhotoLensFacts): LensProfileLookup {
  const camera = findCamera(db, facts.camera);
  if (!facts.lens?.trim() && !camera) return { kind: 'no-lens' };
  const lens = findLens(db, facts.lens, camera);
  if (!lens) return facts.lens?.trim() ? { kind: 'not-found', lens: facts.lens.trim() } : { kind: 'no-lens' };

  const measured = [...new Set([...lens.distortion, ...lens.vignetting].map((p) => p.focal))];
  const focal = facts.focalLengthMm && facts.focalLengthMm > 0 ? facts.focalLengthMm : measured.length === 1 ? measured[0] : NaN;
  if (!Number.isFinite(focal)) return { kind: 'no-focal' };

  const notes: LensProfileNote[] = [];
  let crop = camera?.crop;
  if (!crop && facts.focalLength35mm && facts.focalLengthMm) {
    const fromExif = facts.focalLength35mm / facts.focalLengthMm;
    if (fromExif >= 0.3 && fromExif <= 12) crop = fromExif;
  }
  if (!crop) { crop = lens.crop; notes.push('assumed-sensor'); }

  const profile: LensProfile = { name: [lens.maker, lens.model].filter(Boolean).join(' ').replace(/^(\S+) \1 /i, '$1 ') };
  const d = distortionAt(lens.distortion, focal);
  if (d && d.k.some((v) => v !== 0)) {
    profile.distortion = { model: d.model, k: d.k.map((v) => round(v)), scale: round(Math.sqrt(lens.aspect ** 2 + 1) * lens.crop / crop) };
  } else notes.push('no-distortion');
  const hasAperture = !!facts.apertureF && facts.apertureF > 0;
  const v = hasAperture ? vignettingAt(lens.vignetting, focal, facts.apertureF!) : null;
  if (v && v.some((k) => k !== 0)) profile.vignetting = { k: v.map((k) => round(k)) as [number, number, number], scale: round(lens.crop / crop) };
  else notes.push(lens.vignetting.length && !hasAperture ? 'no-aperture' : 'no-vignetting');

  if (!profile.distortion && !profile.vignetting) return { kind: 'not-found', lens: facts.lens?.trim() || profile.name };
  if (notes.length) profile.notes = notes;
  return { kind: 'found', profile };
}
