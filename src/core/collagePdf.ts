/** Small dependency-free RGB/JPEG PDF assembler for album pages.
 * Pages are placed in physical points with Media, Bleed and Trim boxes.
 * This is a photo-lab RGB PDF, not a certified PDF/X or CMYK press output. */
export interface PdfRasterPage {
  jpeg: Uint8Array;
  pixels: { width: number; height: number };
  mediaMm: { width: number; height: number };
  bleedMm: number;
}
const enc = new TextEncoder();
const txt = (s: string): Uint8Array => enc.encode(s);
const join = (...blocks: Uint8Array[]): Uint8Array => {
  const bytes = new Uint8Array(blocks.reduce((n, block) => n + block.length, 0));
  let offset = 0;
  for (const block of blocks) { bytes.set(block, offset); offset += block.length; }
  return bytes;
};
const pt = (mm: number) => Number((mm * 72 / 25.4).toFixed(5));
/** Read enough JPEG structure to confirm an RGB frame and its true dimensions. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number; components: number } {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG file.');
  let p = 2;
  while (p + 10 < bytes.length) {
    if (bytes[p++] !== 0xff) continue;
    while (bytes[p] === 0xff) p += 1;
    const marker = bytes[p++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const size = bytes[p] * 256 + bytes[p + 1];
    if (size < 2 || p + size > bytes.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return {
        height: bytes[p + 3] * 256 + bytes[p + 4],
        width: bytes[p + 5] * 256 + bytes[p + 6],
        components: bytes[p + 7],
      };
    }
    p += size;
  }
  throw new Error('Could not read the JPEG frame header.');
}
export function assembleAlbumPdf(pages: readonly PdfRasterPage[]): Uint8Array {
  if (pages.length === 0 || pages.length > 200) throw new Error('Choose between 1 and 200 pages.');
  const objects: Uint8Array[] = [
    txt('<< /Type /Catalog /Pages 2 0 R >>'),
    txt(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>`),
  ];
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const { width, height, components } = jpegDimensions(page.jpeg);
    if (width !== page.pixels.width || height !== page.pixels.height || components !== 3) {
      throw new Error(`Page ${i + 1} must have a verified RGB JPEG at its actual output resolution.`);
    }
    const { mediaMm, bleedMm } = page;
    if (![mediaMm.width, mediaMm.height, bleedMm].every(Number.isFinite) || mediaMm.width <= 0 ||
        mediaMm.height <= 0 || mediaMm.width > 1200 || mediaMm.height > 1200 ||
        bleedMm < 0 || bleedMm > 10 || bleedMm * 2 >= Math.min(mediaMm.width, mediaMm.height)) {
      throw new Error(`Invalid print dimensions on page ${i + 1}.`);
    }
    const W = pt(mediaMm.width), H = pt(mediaMm.height), B = pt(bleedMm);
    const base = 3 + i * 3;
    const contents = txt(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`);
    objects.push(txt(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /BleedBox [0 0 ${W} ${H}] /TrimBox [${B} ${B} ${pt(mediaMm.width - bleedMm)} ${pt(mediaMm.height - bleedMm)}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 ${base + 2} 0 R >> >> /Contents ${base + 1} 0 R >>`));
    objects.push(join(txt(`<< /Length ${contents.length} >>\nstream\n`), contents, txt('endstream')));
    objects.push(join(txt(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`), page.jpeg, txt('\nendstream')));
  }
  const parts: Uint8Array[] = [new Uint8Array([37,80,68,70,45,49,46,52,10,37,226,227,207,211,10])];
  const offsets: number[] = [0];
  let position = parts[0].length;
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(position);
    const part = join(txt(`${i + 1} 0 obj\n`), objects[i], txt('\nendobj\n'));
    parts.push(part); position += part.length;
  }
  const xref = position;
  parts.push(txt(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return join(...parts);
}
