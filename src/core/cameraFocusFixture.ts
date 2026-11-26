/**
 * Synthetic camera files for the camera-focus tests: a minimal JPEG whose EXIF carries Make, Model and a Nikon type-3
 * maker note with one AFInfo2 (0x00B7) record laid out as ExifTool's Nikon tag tables document it. No real photo, no
 * camera maker's bytes: every value is chosen by the test. ExifTool 13 decodes the same bytes to the same values.
 */
type Order = 'MM' | 'II';

class Writer {
  bytes: number[] = [];
  constructor(readonly order: Order) {}
  u8(value: number) { this.bytes.push(value & 0xff); }
  u16(value: number) { if (this.order === 'MM') this.bytes.push((value >> 8) & 0xff, value & 0xff); else this.bytes.push(value & 0xff, (value >> 8) & 0xff); }
  u32(value: number) {
    const b = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    this.bytes.push(...(this.order === 'MM' ? b : b.reverse()));
  }
  ascii(text: string) { for (const ch of text) this.u8(ch.charCodeAt(0)); }
  at(offset: number) { while (this.bytes.length < offset) this.u8(0); }
}

interface Entry { tag: number; type: number; count: number; data: number[] }

/** One TIFF IFD whose out-of-line data follows it; offsets are relative to the TIFF header at `base`. */
function ifd(w: Writer, base: number, entries: Entry[], next = 0) {
  const start = w.bytes.length;
  let data = start - base + 2 + entries.length * 12 + 4;
  const tail: number[] = [];
  w.u16(entries.length);
  for (const entry of entries.sort((a, b) => a.tag - b.tag)) {
    w.u16(entry.tag); w.u16(entry.type); w.u32(entry.count);
    if (entry.data.length <= 4) { const padded = [...entry.data, 0, 0, 0, 0].slice(0, 4); w.bytes.push(...padded); }
    else { w.u32(data); tail.push(...entry.data); data += entry.data.length; if (data % 2) { tail.push(0); data++; } }
  }
  w.u32(next);
  w.bytes.push(...tail);
}

const asciiData = (text: string) => [...text].map((ch) => ch.charCodeAt(0)).concat(0);
const u16Data = (order: Order, value: number) => (order === 'MM' ? [(value >> 8) & 0xff, value & 0xff] : [value & 0xff, (value >> 8) & 0xff]);

export interface NikonAfInfo2Fixture {
  version: '0300' | '0400' | '0401' | '0402';
  detectionMethod?: number;
  areaMode: number;
  coordinatesAvailable: boolean;
  afImage: [number, number];
  /** Centre of the AF area, in AF-image pixels. */
  centre: [number, number];
  size: [number, number];
  /** Expeed 7 only: 1 in focus, 0 out of focus. */
  focusResult?: number;
}

/** The AFInfo2 record's bytes, at the offsets ExifTool documents for AFInfo2V0300 and AFInfo2V0400. */
export function nikonAfInfo2Bytes(order: Order, f: NikonAfInfo2Fixture): number[] {
  const expeed7 = f.version !== '0300';
  const out = new Array<number>(expeed7 ? 84 : 60).fill(0);
  [...f.version].forEach((ch, i) => { out[i] = ch.charCodeAt(0); });
  out[4] = f.detectionMethod ?? 2;
  out[5] = f.areaMode;
  out[7] = f.coordinatesAvailable ? 1 : 0;
  const put = (at: number, value: number) => { out.splice(at, 2, ...u16Data(order, value)); };
  const o = expeed7 ? 0x3e : 0x2a;
  put(o, f.afImage[0]); put(o + 2, f.afImage[1]);
  put(o + 4, f.centre[0]); put(o + 6, f.centre[1]);
  put(o + 8, f.size[0]); put(o + 10, f.size[1]);
  if (expeed7) out[0x4a] = f.focusResult ?? 0;
  return out;
}

/** A Nikon type-3 maker note ("Nikon\0" + version + its own TIFF header) holding AFInfo2. */
export function nikonMakerNote(order: Order, afInfo2: number[]): number[] {
  const w = new Writer(order);
  w.ascii('Nikon'); w.u8(0); w.u8(2); w.u8(0x10); w.u8(0); w.u8(0);
  const base = w.bytes.length;
  w.ascii(order); w.u16(42); w.u32(8);
  ifd(w, base, [
    { tag: 0x0001, type: 7, count: 4, data: [0x30, 0x32, 0x31, 0x31] },
    { tag: 0x00b7, type: 7, count: afInfo2.length, data: afInfo2 },
  ]);
  return w.bytes;
}

/** A small JPEG (no picture data needed by the readers) with EXIF Make, Model and the given maker note. */
export function jpegWithMakerNote(make: string, model: string, makerNote: number[], order: Order = 'MM'): Uint8Array {
  const w = new Writer(order);
  w.ascii(order); w.u16(42); w.u32(8);
  // IFD0 at 8: Make, Model, ExifIFD pointer. Its size is known up front, so the Exif IFD's offset can be computed.
  const makeData = asciiData(make), modelData = asciiData(model);
  const pad = (n: number) => n + (n % 2);
  const ifd0Size = 2 + 3 * 12 + 4 + (makeData.length > 4 ? pad(makeData.length) : 0) + (modelData.length > 4 ? pad(modelData.length) : 0);
  const exifAt = 8 + ifd0Size;
  ifd(w, 0, [
    { tag: 0x010f, type: 2, count: makeData.length, data: makeData },
    { tag: 0x0110, type: 2, count: modelData.length, data: modelData },
    { tag: 0x8769, type: 4, count: 1, data: order === 'MM' ? [0, 0, (exifAt >> 8) & 0xff, exifAt & 0xff] : [exifAt & 0xff, (exifAt >> 8) & 0xff, 0, 0] },
  ]);
  w.at(exifAt);
  ifd(w, 0, [{ tag: 0x927c, type: 7, count: makerNote.length, data: makerNote }]);
  const tiff = w.bytes;
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...app1, 0xff, 0xd9]);
}
