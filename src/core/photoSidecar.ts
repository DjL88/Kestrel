import { addTags } from './subjectTags';
import { safeExportName } from './exportPlace';
import { sidecarXmpPacket } from './tiffExportMetadata';
import type { PhotoFrame } from './types';

function sidecarFilename(frame: PhotoFrame): string {
  const base = frame.filename.replace(/\.[^.]+$/, '');
  const suffix = frame.virtualCopy ? `-copy-${frame.virtualCopy.number}` : '';
  const stem = safeExportName(base).slice(0, 140 - suffix.length);
  return stem + suffix + '.xmp';
}

export function photoSidecar(frame: PhotoFrame) {
  const automated = new Set(frame.autoTags?.map(tag => tag.trim().toLowerCase()));
  const keywords = [...(frame.subjectNames ?? []), ...(frame.tags ?? [])]
    .filter(tag => !automated.has(tag.trim().toLowerCase()));
  const pick = frame.decision === 'keep' ? 1 : frame.decision === 'reject' ? -1 : 0;
  return {
    filename: sidecarFilename(frame),
    bytes: sidecarXmpPacket(frame.rating ?? frame.exif.rating ?? 0, pick, keywords),
  };
}

export interface ImportedPhotoSidecar {
  rating?: number;
  decision?: PhotoFrame['decision'];
  keywords: string[];
  /** Lightroom / Camera Raw develop settings (crs:), as written, when the sidecar has them. */
  cameraRaw?: Record<string, string>;
}

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XMP = 'http://ns.adobe.com/xap/1.0/';
const XMP_DM = 'http://ns.adobe.com/xmp/1.0/DynamicMedia/';
const DC = 'http://purl.org/dc/elements/1.1/';
const CRS = 'http://ns.adobe.com/camera-raw-settings/1.0/';
/** The Camera Raw settings InFlight can carry over; everything else in the block is left alone. */
export const CAMERA_RAW_KEYS = ['ProcessVersion', 'Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012', 'Clarity2012', 'Vibrance', 'Saturation', 'ConvertToGrayscale', 'Dehaze', 'Texture', 'LuminanceSmoothing', 'PostCropVignetteAmount', 'GrainAmount'] as const;
const MAX_SIDECAR_BYTES = 1024 * 1024;

/** Only apply explicitly chosen, matching sidecars. Never read edits or original EXIF. */
export async function readPhotoSidecar(file: File, frame: PhotoFrame): Promise<ImportedPhotoSidecar> {
  if (file.name.toLowerCase() !== sidecarFilename(frame).toLowerCase()
    || file.size === 0 || file.size > MAX_SIDECAR_BYTES) throw new Error('Invalid sidecar file.');
  const xml = await file.text();
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('Unsupported XMP declaration.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('Invalid XMP.');
  const descriptions = Array.from(document.getElementsByTagNameNS(RDF, 'Description'))
    .filter(element => element.parentElement?.namespaceURI === RDF && element.parentElement.localName === 'RDF');
  const child = (element: Element, namespace: string, name: string) =>
    Array.from(element.children).find(node => node.namespaceURI === namespace && node.localName === name);
  const field = (namespace: string, name: string) => descriptions.map(element =>
    (element.getAttributeNS(namespace, name) ?? child(element, namespace, name)?.textContent)?.trim()).find(Boolean);
  const stars = field(XMP, 'Rating');
  const pick = field(XMP_DM, 'pick');
  const rating = stars && /^[0-5]$/.test(stars) ? Number(stars) : undefined;
  const decision = pick === '1' ? 'keep' : pick === '-1' || (pick === undefined && stars === '-1') ? 'reject'
    : pick === '0' ? 'unreviewed' : undefined;
  const keywords = descriptions.flatMap(element => {
    const subject = child(element, DC, 'subject');
    const bag = subject && child(subject, RDF, 'Bag');
    return bag ? Array.from(bag.children).filter(item => item.namespaceURI === RDF && item.localName === 'li')
      .map(item => item.textContent ?? '') : [];
  });
  const accepted = addTags([], keywords);
  const cameraRaw: Record<string, string> = {};
  for (const key of CAMERA_RAW_KEYS) {
    const value = field(CRS, key);
    if (value && value.length <= 32) cameraRaw[key] = value;
  }
  const hasEdit = Object.keys(cameraRaw).some((key) => key !== 'ProcessVersion');
  if (rating === undefined && !decision && !accepted.length && !hasEdit) throw new Error('No supported XMP metadata.');
  return { rating, decision, keywords: accepted, ...(hasEdit ? { cameraRaw } : {}) };
}
