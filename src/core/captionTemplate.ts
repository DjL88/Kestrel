import type { PhotoFrame } from './types';
import type { TiffExportMetadata } from './tiffExportMetadata';

/**
 * Captions and credits (IPTC) for exported files, with code replacements in the style press photographers know from
 * Photo Mechanic: write `\z8\` in a caption and the export puts in the text saved for `z8`. A few photo fields fill
 * themselves: {filename}, {date}, {camera}, {lens} and {subject}. Nothing is copied from the original file except what
 * these fields name; GPS and serial numbers never leave the device.
 */
export interface CaptionTemplate {
  enabled: boolean;
  title: string;
  caption: string;
  creator: string;
  copyright: string;
  credit: string;
  city: string;
  country: string;
  keywords: string;
  /** One per line: `code = text`. */
  codes: string;
}

export const EMPTY_CAPTION_TEMPLATE: CaptionTemplate = {
  enabled: false, title: '', caption: '', creator: '', copyright: '', credit: '', city: '', country: '', keywords: '', codes: '',
};

const LIMITS: Record<Exclude<keyof CaptionTemplate, 'enabled'>, number> = {
  title: 200, caption: 4096, creator: 200, copyright: 300, credit: 200, city: 100, country: 100, keywords: 2048, codes: 20_000,
};

export function parseCaptionTemplate(value: unknown): CaptionTemplate {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const out = { ...EMPTY_CAPTION_TEMPLATE, enabled: item.enabled === true };
  for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    out[key] = typeof item[key] === 'string' ? (item[key] as string).slice(0, LIMITS[key]) : '';
  }
  return out;
}

/** `z8 = Nikon Z 8`, `z8<tab>Nikon Z 8` or `z8: Nikon Z 8`. Codes match ignoring case; the first of a repeated code wins. */
export function parseCodeReplacements(text: string): Map<string, string> {
  const codes = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^\s=:\t\\]+)\s*(?:=|:|\t)\s*(.*?)\s*$/.exec(line);
    if (!match || !match[2]) continue;
    const code = match[1].toLocaleLowerCase('en-GB');
    if (!codes.has(code)) codes.set(code, match[2]);
  }
  return codes;
}

export type CaptionFields = Partial<Record<'filename' | 'date' | 'camera' | 'lens' | 'subject', string>>;

/** The photo's own fields. Unknown stays blank, never guessed. */
export function captionFieldsFor(frame: Pick<PhotoFrame, 'filename' | 'exif' | 'subjectNames'>): CaptionFields {
  const stamp = frame.exif?.captureStamp?.original;
  const day = stamp && /^(\d{4}):(\d{2}):(\d{2})/.exec(stamp);
  const date = day
    ? new Date(Date.UTC(+day[1], +day[2] - 1, +day[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';
  return {
    filename: frame.filename.replace(/\.[^.]+$/, ''),
    date,
    camera: frame.exif?.camera?.trim() ?? '',
    lens: frame.exif?.lens?.trim() ?? '',
    subject: (frame.subjectNames ?? []).map((name) => name.trim()).filter(Boolean).join(', '),
  };
}

/** Replace `\code\` and `{field}`. An unknown code is left as typed, so a mistake shows in the file instead of vanishing. */
export function expandCaption(text: string, codes: ReadonlyMap<string, string>, fields: CaptionFields): string {
  const once = (value: string) => value
    .replace(/\\([^\s\\]+)\\/g, (whole, code: string) => codes.get(code.toLocaleLowerCase('en-GB')) ?? whole);
  // Codes may use fields ({camera}) and one level of other codes, never loop.
  return once(once(text)).replace(/\{(filename|date|camera|lens|subject)\}/gi,
    (_, name: string) => fields[name.toLowerCase() as keyof CaptionFields] ?? '')
    .replace(/[ \t]{2,}/g, ' ').trim();
}

/** The XMP fields for one photo. null when captions are switched off. */
export function captionMetadataFor(frame: Pick<PhotoFrame, 'filename' | 'exif' | 'subjectNames'>, template: CaptionTemplate): TiffExportMetadata | null {
  if (!template.enabled) return null;
  const codes = parseCodeReplacements(template.codes);
  const fields = captionFieldsFor(frame);
  const fill = (text: string) => expandCaption(text, codes, fields);
  const keywords = [...new Set(fill(template.keywords).split(/[,;\n]/).map((word) => word.trim()).filter(Boolean))].slice(0, 64);
  return {
    title: fill(template.title), caption: fill(template.caption), creator: fill(template.creator),
    copyright: fill(template.copyright), credit: fill(template.credit), city: fill(template.city), country: fill(template.country),
    keywords,
  };
}

const STORE_KEY = 'inflight.captionTemplate.v1';
export function readCaptionTemplate(store: Pick<Storage, 'getItem'> | null): CaptionTemplate {
  try { return parseCaptionTemplate(JSON.parse(store?.getItem(STORE_KEY) ?? 'null')); } catch { return { ...EMPTY_CAPTION_TEMPLATE }; }
}
export function writeCaptionTemplate(store: Pick<Storage, 'setItem'> | null, template: CaptionTemplate): boolean {
  try { store?.setItem(STORE_KEY, JSON.stringify(parseCaptionTemplate(template))); return Boolean(store); } catch { return false; }
}
