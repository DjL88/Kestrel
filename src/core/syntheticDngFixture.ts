// Test-only: synthetic DNG files built in memory (no real photo). Imported by tests, never by the app.
/**
 * A synthetic DNG laid out like Lightroom's linear JPEG XL DNGs: IFD0 is a small baseline-JPEG thumbnail (strips), and
 * its SubIFDs hold the main image and any other images. No real photo: the "JPEG" is a valid marker stream only.
 */
type Tag = [tag: number, type: number, value: number];
export function jpegStream(width: number, height: number, length = 6000): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8]);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  bytes.set([3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 11);
  bytes.set([0xff, 0xd9], length - 2);
  return bytes;
}
export function syntheticDng(options: { main: number; others?: [subfile: number, compression: number][]; thumb?: Uint8Array; little?: boolean }): Blob {
  const little = options.little ?? true;
  const thumb = options.thumb ?? jpegStream(256, 171);
  const subs: Tag[][] = [[[0x00fe, 4, 0], [0x0103, 3, options.main]], ...(options.others ?? []).map(([s, c]): Tag[] => [[0x00fe, 4, s], [0x0103, 3, c]])];
  const size = (tags: Tag[]) => 2 + tags.length * 12 + 4;
  const ifd0Tags = 6;
  let at = 8 + 2 + ifd0Tags * 12 + 4;
  const subOffsets = subs.map((tags) => { const here = at; at += size(tags); return here; });
  const offsetsArray = at; at += subs.length * 4;
  const thumbAt = at;
  const ifd0: Tag[] = [
    [0x00fe, 4, 1], [0x0103, 3, 7], [0x0106, 3, 6], [0x0111, 4, thumbAt], [0x0117, 4, thumb.length],
    [0x014a, 4, subs.length === 1 ? subOffsets[0] : offsetsArray],
  ];
  const out = new Uint8Array(thumbAt + thumb.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  const write = (offset: number, tags: Tag[]) => {
    view.setUint16(offset, tags.length, little);
    tags.forEach(([tag, type, value], i) => {
      const e = offset + 2 + i * 12;
      view.setUint16(e, tag, little); view.setUint16(e + 2, type, little); view.setUint32(e + 4, tag === 0x014a ? subs.length : 1, little);
      if (type === 3) view.setUint16(e + 8, value, little); else view.setUint32(e + 8, value, little);
    });
    view.setUint32(offset + 2 + tags.length * 12, 0, little);
  };
  write(8, ifd0);
  subs.forEach((tags, i) => write(subOffsets[i], tags));
  subOffsets.forEach((offset, i) => view.setUint32(offsetsArray + i * 4, offset, little));
  out.set(thumb, thumbAt);
  return new Blob([out]);
}
