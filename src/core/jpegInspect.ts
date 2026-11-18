/**
 * Structural checks on a small JPEG before it leaves (client) or is forwarded
 * (control plane): its size in pixels, and whether any camera metadata
 * (EXIF, which can hold GPS, or XMP) is still inside. Reads markers only;
 * never decodes pixels.
 */
export interface JpegFacts {
  width: number;
  height: number;
  /** An APP1 Exif or XMP segment is present. Kestrel only sends redrawn, metadata-free images. */
  hasMetadata: boolean;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + length)));

/** Facts about a JPEG, or null if it is not a well-formed baseline/progressive JPEG header. */
export function inspectJpeg(bytes: Uint8Array): JpegFacts | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2, width = 0, height = 0, hasMetadata = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset += 1; continue; } // fill byte
    if (marker === 0xd9 || marker === 0xda) break;  // end, or start of scan: headers are over
    if (marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    const data = offset + 4;
    if (marker === 0xe1) {
      const head = ascii(bytes, data, 29);
      if (head.startsWith('Exif\0') || head.startsWith('http://ns.adobe.com/xap/1.0/')) hasMetadata = true;
    }
    if (SOF.has(marker) && length >= 7) {
      height = (bytes[data + 1] << 8) | bytes[data + 2];
      width = (bytes[data + 3] << 8) | bytes[data + 4];
    }
    offset += 2 + length;
  }
  return width > 0 && height > 0 ? { width, height, hasMetadata } : null;
}
