/**
 * Opt-in, privacy-first TIFF XMP metadata.
 *
 * No original EXIF, GPS, serial number or capture location is copied implicitly.
 * Callers must pass only fields the photographer has chosen for the export.
 * This does not change photograph pixels or its ICC colour profile.
 */
export interface TiffExportMetadata {
  title?: string;
  caption?: string;
  creator?: string;
  copyright?: string;
  keywords?: readonly string[];
}

const MAX_FIELD_CHARS = 4096;
const MAX_KEYWORDS = 64;
const MAX_PACKET_BYTES = 64 * 1024;
const xmlValue = (text: string): string => Array.from(text)
  // Array.from preserves valid Unicode surrogate pairs (including emoji).
  // Lone surrogates are not valid in XML 1.0 and must be discarded.
  .filter(char => !(char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff))
  .join('')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const field = (value: unknown): string =>
  typeof value === 'string' ? xmlValue(Array.from(value.trim()).slice(0, MAX_FIELD_CHARS).join('')) : '';

const alt = (name: string, content: string) =>
  `<dc:${name}><rdf:Alt><rdf:li xml:lang="x-default">${content}</rdf:li></rdf:Alt></dc:${name}>`;
const bag = (name: string, values: readonly string[]) =>
  `<dc:${name}><rdf:Bag>${values.map(value => `<rdf:li>${value}</rdf:li>`).join('')}</rdf:Bag></dc:${name}>`;

/** null means 'strip all optional metadata', including geolocation. */
export function tiffXmpPacket(metadata: TiffExportMetadata | null | undefined, rating?: number): Uint8Array | null {
  if (!metadata) return null;
  const title = field(metadata.title);
  const caption = field(metadata.caption);
  const creator = field(metadata.creator);
  const rights = field(metadata.copyright);
  const keywords = Array.isArray(metadata.keywords)
    ? [...new Set(metadata.keywords.slice(0, MAX_KEYWORDS).map(field).filter(Boolean))]
    : [];
  const ratingField = rating !== undefined && Number.isInteger(rating) && rating >= -1 && rating <= 5
    ? `<xmp:Rating xmlns:xmp="http://ns.adobe.com/xap/1.0/">${rating}</xmp:Rating>` : '';
  const fields = [
    ratingField,
    title ? alt('title', title) : '',
    caption ? alt('description', caption) : '',
    creator ? bag('creator', [creator]) : '',
    rights ? alt('rights', rights) : '',
    keywords.length ? bag('subject', keywords) : '',
  ].filter(Boolean).join('');
  if (!fields) return null;
  const packet = `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    fields + `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const bytes = new TextEncoder().encode(packet);
  if (bytes.length > MAX_PACKET_BYTES) throw new Error('The export metadata is too large for a TIFF.');
  return bytes;
}
