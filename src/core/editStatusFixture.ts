/** Synthetic JPEG bytes for the edit-status tests: no real photo, only the metadata segments under test. */
function u16(n: number) { return [n >> 8 & 255, n & 255]; }
function u32(n: number) { return [n >>> 24 & 255, n >> 16 & 255, n >> 8 & 255, n & 255]; }

interface TiffEntry { tag: number; type: 2 | 4 | 7; value: Uint8Array | number }

/** A big-endian TIFF block with IFD0 (Make, Model, Software) and an EXIF IFD (MakerNote) when asked. */
function tiff(ifd0: { make?: string; model?: string; software?: string }, makerNote?: Uint8Array): Uint8Array {
  const ascii = (s: string) => new TextEncoder().encode(s + '\0');
  const entries0: TiffEntry[] = [];
  if (ifd0.make) entries0.push({ tag: 0x010f, type: 2, value: ascii(ifd0.make) });
  if (ifd0.model) entries0.push({ tag: 0x0110, type: 2, value: ascii(ifd0.model) });
  if (ifd0.software) entries0.push({ tag: 0x0131, type: 2, value: ascii(ifd0.software) });
  const exifEntries: TiffEntry[] = makerNote ? [{ tag: 0x927c, type: 7, value: makerNote }] : [];
  if (exifEntries.length) entries0.push({ tag: 0x8769, type: 4, value: 0 });
  entries0.sort((a, b) => a.tag - b.tag);
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(entries0.length);
  let dataAt = exifAt + (exifEntries.length ? ifdSize(exifEntries.length) : 0);
  const data: number[] = [];
  const write = (list: TiffEntry[], out: number[]) => {
    out.push(...u16(list.length));
    for (const entry of list) {
      out.push(...u16(entry.tag), ...u16(entry.type));
      if (typeof entry.value === 'number') { out.push(...u32(1), ...u32(entry.tag === 0x8769 ? exifAt : entry.value)); continue; }
      out.push(...u32(entry.value.length));
      if (entry.value.length <= 4) { const v = [...entry.value]; while (v.length < 4) v.push(0); out.push(...v); continue; }
      out.push(...u32(dataAt));
      data.push(...entry.value);
      dataAt += entry.value.length;
    }
    out.push(...u32(0));
  };
  const out: number[] = [0x4d, 0x4d, 0, 42, ...u32(ifd0At)];
  write(entries0, out);
  if (exifEntries.length) write(exifEntries, out);
  return new Uint8Array([...out, ...data]);
}

function segment(marker: number, body: Uint8Array): number[] {
  return [0xff, marker, ...u16(body.length + 2), ...body];
}

export interface SyntheticJpeg {
  make?: string;
  model?: string;
  software?: string;
  makerNote?: boolean;
  /** rdf:Description attributes and children, inside one XMP packet. */
  xmp?: string;
  /** Raw bytes for an APP11 segment (C2PA's JUMBF box), as text. */
  app11?: string;
}

/** A tiny JPEG header with the asked-for EXIF, XMP and APP11 segments. Not decodable as a picture; it does not need to be. */
export function syntheticJpeg(options: SyntheticJpeg): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  if (options.make || options.model || options.software || options.makerNote) {
    const exif = tiff(options, options.makerNote ? new TextEncoder().encode('Nikon\0\x02\x10\0\0MM\0*\0\0\0\x08\0\0') : undefined);
    bytes.push(...segment(0xe1, new Uint8Array([...new TextEncoder().encode('Exif\0\0'), ...exif])));
  }
  if (options.xmp) {
    const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"' +
      ' xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"' +
      ` ${options.xmp}</rdf:Description></rdf:RDF></x:xmpmeta>`;
    bytes.push(...segment(0xe1, new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0' + xml)));
  }
  if (options.app11) bytes.push(...segment(0xeb, new TextEncoder().encode(options.app11)));
  bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes);
}
