/**
 * Was this photo already edited in another app? Read only from evidence in the file itself, never guessed from the
 * pixels: Lightroom/Camera Raw settings (XMP `crs:`), an XMP edit history, the app that wrote the file (XMP CreatorTool,
 * EXIF Software), or C2PA edit actions say "Edited elsewhere". A RAW, or a camera JPEG/HEIF that still carries the
 * camera's maker notes and names no editing app, says "Straight from the camera". Anything else stays "Unknown".
 *
 * Edit evidence always wins over camera evidence: an export from Lightroom keeps the maker notes but also says it was
 * edited. A vision model may add a worded guess elsewhere, but it never sets this status.
 */
import { hasCarriedDevelop, parseDevelopSettings } from './lightroomCatalogue';

export type EditStatusKind = 'edited-elsewhere' | 'camera' | 'unknown';

export type EditEvidence =
  | { kind: 'develop-settings'; app?: string }
  | { kind: 'edit-history'; app?: string }
  /** Develop settings or an edit history in an XMP sidecar file beside the photo (Lightroom, darktable, Capture One). */
  | { kind: 'sidecar'; app?: string }
  | { kind: 'editing-app'; app: string }
  | { kind: 'content-credentials'; actions: string[] }
  | { kind: 'raw-file' }
  | { kind: 'maker-notes' }
  | { kind: 'unrecognised-app'; app: string };

export interface EditStatus {
  kind: EditStatusKind;
  /** What the decision rests on, strongest first. Empty for "Unknown" with nothing to go on. */
  evidence: EditEvidence[];
}

export interface EditStatusInput {
  isRaw: boolean;
  make?: unknown;
  /** EXIF IFD0 Software. */
  software?: unknown;
  /** XMP CreatorTool. */
  creatorTool?: unknown;
  /** The XMP `crs:` block as exifr reads it (key → value). */
  crs?: unknown;
  /** The XMP `xmpMM` block (History, DerivedFrom). */
  xmpMM?: unknown;
  hasMakerNote: boolean;
  /** C2PA action labels found in the file (see c2paActionsIn). */
  c2paActions?: string[];
}

/** Apps whose name in Software/CreatorTool means the file was saved by an editor, not a camera. */
const EDITORS = /\b(photoshop|lightroom|camera raw|capture one|dxo|photolab|affinity|gimp|darktable|rawtherapee|luminar|skylum|pixelmator|snapseed|picasa|on1|topaz|acdsee|paint ?shop|paint\.net|canva|instagram|vsco|facetune|imagemagick|graphicsmagick|photoscape|faststone|irfanview|exposure x|silkypix|digital photo professional|nx studio|capture nx|photomator|polarr|picsart|lightzone|photo ?direktor|photoworks|krita|photopea|fotor|aperture|iphoto|google photos|windows photo|microsoft photos|apple photos)\b/i;

/** Camera firmware strings: "Ver.1.00", "Firmware Version 1.1", "Digital Camera X-T4 Ver1.20", "ILCE-7M4 v2.00", "1.00". */
const FIRMWARE = [/^(?:[\w .-]*\s)?(?:ver(?:sion)?\.?\s*\d+(?:\.\d+)*|firmware\b.*)$/i, /^[A-Z0-9 -]*\bv\s?\d+(?:\.\d+)+$/, /^\d+(?:\.\d+)+[a-z]?$/i];

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/[\0\s]+$/, '').slice(0, 120) : undefined;
}

/**
 * What an app name says: 'editor' for a known editing app, 'camera' for firmware or the camera's own name, and
 * 'other' for a name we do not recognise (which blocks "Straight from the camera" but does not prove an edit).
 */
export function classifyApp(app: string, make?: string): 'editor' | 'camera' | 'other' {
  if (EDITORS.test(app)) return 'editor';
  if (FIRMWARE.some((pattern) => pattern.test(app))) return 'camera';
  const brand = make?.split(/\s+/)[0]?.toLowerCase();
  if (brand && brand.length > 1 && app.toLowerCase().includes(brand)) return 'camera';
  // Phone cameras write their OS version ("17.1.2", "HDR+ 1.0.5", "Android ...").
  if (/^(ios|android|hdr\+|samsung|pixel|oneplus|xiaomi|huawei|oppo|vivo)(?=[\s\d.]|$)/i.test(app)) return 'camera';
  return 'other';
}

/** Lightroom/Camera Raw settings from XMP, read through the catalogue's own develop parser. */
function developFromCrs(crs: unknown): boolean {
  if (!crs || typeof crs !== 'object') return false;
  const entries = Object.entries(crs as Record<string, unknown>);
  if (!entries.length) return false;
  const lua = entries.map(([key, value]) =>
    typeof value === 'number' && Number.isFinite(value) ? `${key} = ${value},`
      : typeof value === 'boolean' ? `${key} = ${value},`
        : typeof value === 'string' ? `${key} = "${value.replace(/"/g, '')}",`
          : `${key} = { },`).join('\n');
  const develop = parseDevelopSettings(`s = {\n${lua}\n}`);
  if (hasCarriedDevelop(develop) || develop.notCarried.some((reason) => reason !== 'old-process')) return true;
  // Older process versions use other sliders; Camera Raw's own flag still says settings were saved.
  return (crs as Record<string, unknown>).HasSettings === true && develop.notCarried.includes('old-process');
}

function historyApps(xmpMM: unknown): { edited: boolean; app?: string } {
  if (!xmpMM || typeof xmpMM !== 'object') return { edited: false };
  const record = xmpMM as Record<string, unknown>;
  const raw = record.History;
  const events = (Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []) as Record<string, unknown>[];
  // Lightroom records a metadata-only save (a rating, a keyword) as "saved" with changed="/metadata": not an edit.
  const changes = events.filter((event) => event && typeof event === 'object' && typeof event.action === 'string' && event.action !== 'created'
    && !(typeof event.changed === 'string' && event.changed.trim() === '/metadata'));
  const app = changes.map((event) => text(event.softwareAgent)).find(Boolean);
  return { edited: changes.length > 0 || record.DerivedFrom != null, app };
}

/** The status, from what the file says about itself. */
export function readEditStatus(input: EditStatusInput): EditStatus {
  const make = text(input.make);
  const evidence: EditEvidence[] = [];
  const creator = text(input.creatorTool);
  const software = text(input.software);
  const editorApp = [creator, software].find((app) => app && classifyApp(app, make) === 'editor');

  if (developFromCrs(input.crs)) evidence.push({ kind: 'develop-settings', ...(editorApp ? { app: editorApp } : {}) });
  const history = historyApps(input.xmpMM);
  if (history.edited) evidence.push({ kind: 'edit-history', ...(history.app ?? editorApp ? { app: history.app ?? editorApp } : {}) });
  if (editorApp && !evidence.length) evidence.push({ kind: 'editing-app', app: editorApp });
  const edits = (input.c2paActions ?? []).filter((action) => C2PA_EDIT_ACTIONS.has(action));
  if (edits.length) evidence.push({ kind: 'content-credentials', actions: edits });
  if (evidence.length) return { kind: 'edited-elsewhere', evidence };

  const unrecognised = [creator, software].find((app) => app && classifyApp(app, make) === 'other');
  if (unrecognised) return { kind: 'unknown', evidence: [{ kind: 'unrecognised-app', app: unrecognised }] };
  if (input.isRaw) return { kind: 'camera', evidence: [{ kind: 'raw-file' }] };
  if (input.hasMakerNote) return { kind: 'camera', evidence: [{ kind: 'maker-notes' }] };
  return { kind: 'unknown', evidence: [] };
}

/** The sidecar names editing apps use beside a photo: "DSC_0001.xmp" (Lightroom, Camera Raw) and "DSC_0001.NEF.xmp" (darktable). */
export function sidecarFilenames(filename: string): string[] {
  const stem = filename.replace(/\.[^.]+$/, '');
  return stem && stem !== filename ? [`${stem}.xmp`, `${filename}.xmp`] : [`${filename}.xmp`];
}

/** XMP sidecars larger than this are not read for the status (Lightroom's with many masks are a few hundred KB). */
export const MAX_SIDECAR_STATUS_BYTES = 4 << 20;

/**
 * Add what an XMP sidecar says. Develop settings or an edit history in it mean "Edited elsewhere"; a sidecar with only
 * a rating or keywords changes nothing. The file's own edit evidence is kept.
 */
export function withSidecar(status: EditStatus, sidecar: { crs?: unknown; xmpMM?: unknown; creatorTool?: unknown }): EditStatus {
  const history = historyApps(sidecar.xmpMM);
  if (!developFromCrs(sidecar.crs) && !history.edited) return status;
  const creator = text(sidecar.creatorTool);
  const app = history.app ?? (creator && classifyApp(creator) === 'editor' ? creator : undefined);
  const own = status.kind === 'edited-elsewhere' ? status.evidence : [];
  return { kind: 'edited-elsewhere', evidence: [{ kind: 'sidecar', ...(app ? { app } : {}) }, ...own] };
}

/** C2PA actions that change the picture (c2pa.created, c2pa.published and the like do not). */
const C2PA_EDIT_ACTIONS = new Set([
  'c2pa.color_adjustments', 'c2pa.cropped', 'c2pa.drawing', 'c2pa.edited', 'c2pa.filtered', 'c2pa.opened',
  'c2pa.orientation', 'c2pa.placed', 'c2pa.removed', 'c2pa.resized', 'c2pa.converted', 'c2pa.transcoded',
]);

/**
 * The C2PA action labels in a file's bytes. C2PA stores its actions assertion as CBOR, where a short text string is one
 * header byte (0x60 + its length) followed by plain UTF-8, so "c2pa.cropped" appears byte for byte and its header says
 * exactly where it ends. Only read when the file has an actions assertion at all.
 */
export function c2paActionsIn(bytes: Uint8Array): string[] {
  const latin = new TextDecoder('latin1').decode(bytes);
  if (!latin.includes('c2pa.actions')) return [];
  const found = new Set<string>();
  for (let at = latin.indexOf('c2pa.'); at > 0; at = latin.indexOf('c2pa.', at + 5)) {
    const length = bytes[at - 1] - 0x60;
    if (length < 8 || length > 23) continue;
    const label = latin.slice(at, at + length);
    if (/^c2pa\.[a-z_.]+$/.test(label)) found.add(label);
  }
  found.delete('c2pa.actions');
  return [...found];
}
