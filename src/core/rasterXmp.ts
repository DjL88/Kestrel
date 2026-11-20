import { tiffXmpPacket, type TiffExportMetadata } from './tiffExportMetadata';

/** Opt-in XMP in JPEG APP1 or PNG iTXt, without a new image encode.
 * The browser-created raster carries no original EXIF. We add ONLY fields
 * chosen in Export; GPS, serial numbers and camera details are never copied.
 * Existing ICC pixel profiles and encoded pixels remain untouched.
 */
const jpegXmpIdentifier = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0');
const pngXmpKeyword = new TextEncoder().encode('XML:com.adobe.xmp\0');
const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const tailName = [73, 69, 78, 68]; // IEND

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function be32(bytes: Uint8Array, index: number, value: number) {
  bytes[index] = (value >>> 24) & 255;
  bytes[index + 1] = (value >>> 16) & 255;
  bytes[index + 2] = (value >>> 8) & 255;
  bytes[index + 3] = value & 255;
}

export async function embedRasterXmp(
  raster: Blob, format: 'jpeg' | 'png', metadata: TiffExportMetadata | null | undefined,
): Promise<Blob> {
  const packet = tiffXmpPacket(metadata);
  if (!packet) return raster;
  if (format === 'jpeg') {
    const prefix = new Uint8Array(await raster.slice(0, 6).arrayBuffer());
    if (prefix.length < 6 || prefix[0] !== 0xff || prefix[1] !== 0xd8) {
      throw new Error('The encoded JPEG is invalid; no metadata was added.');
    }
    const app1Length = 2 + jpegXmpIdentifier.length + packet.length;
    if (app1Length > 0xffff) throw new Error('The selected metadata is too large for a JPEG.');
    const segment = new Uint8Array(2 + app1Length);
    segment.set([0xff, 0xe1, (app1Length >>> 8) & 255, app1Length & 255], 0);
    segment.set(jpegXmpIdentifier, 4);
    segment.set(packet, 4 + jpegXmpIdentifier.length);
    // Keep any JFIF APP0 marker ahead of our APP1 metadata segment.
    let insertion = 2;
    if (prefix[2] === 0xff && prefix[3] === 0xe0) {
      const app0Length = prefix[4] * 256 + prefix[5];
      if (app0Length < 2 || 4 + app0Length > raster.size) throw new Error('Invalid JPEG header; metadata was not added.');
      insertion = 4 + app0Length;
    }
    return new Blob([raster.slice(0, insertion), segment, raster.slice(insertion)], { type: 'image/jpeg' });
  }

  const [signature, ending] = await Promise.all([
    raster.slice(0, 8).arrayBuffer(), raster.slice(-12).arrayBuffer(),
  ]);
  const first = new Uint8Array(signature), last = new Uint8Array(ending);
  if (raster.size < 20 || first.some((byte, i) => byte !== pngSignature[i]) ||
      last.length !== 12 || last.slice(0, 4).some(byte => byte !== 0) ||
      tailName.some((byte, i) => last[4 + i] !== byte)) {
    throw new Error('The encoded PNG is invalid; no metadata was added.');
  }
  // iTXt: keyword NUL, compression flag 0, compression method 0,
  // empty language NUL, empty translated keyword NUL, then UTF-8 XML.
  const payload = new Uint8Array(pngXmpKeyword.length + 4 + packet.length);
  payload.set(pngXmpKeyword, 0);
  payload.set(packet, pngXmpKeyword.length + 4);
  const name = Uint8Array.from([105, 84, 88, 116]); // iTXt
  const chunk = new Uint8Array(12 + payload.length);
  be32(chunk, 0, payload.length);
  chunk.set(name, 4);
  chunk.set(payload, 8);
  be32(chunk, chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
  // Preserve the original encoded PNG and insert immediately before IEND.
  return new Blob([raster.slice(0, raster.size - 12), chunk, raster.slice(-12)], { type: 'image/png' });
}
