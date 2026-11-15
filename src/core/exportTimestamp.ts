function exifDateBlock(date: Date) {
  const timestamp = date.toISOString().slice(0, 19).replace(/-/g, ':').replace('T', ' ');
  const bytes = new Uint8Array(132);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  const writeTag = (offset: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    view.setUint32(offset + 8, value, true);
  };
  bytes.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
  view.setUint16(8, 2, true);
  writeTag(10, 0x0132, 2, 20, 104);
  writeTag(22, 0x8769, 4, 1, 38);
  view.setUint16(38, 5, true);
  writeTag(40, 0x9003, 2, 20, 104);
  writeTag(52, 0x9004, 2, 20, 104);
  writeTag(64, 0x9010, 2, 7, 124);
  writeTag(76, 0x9011, 2, 7, 124);
  writeTag(88, 0x9012, 2, 7, 124);
  bytes.set(encoder.encode(timestamp), 104);
  bytes.set(encoder.encode('+00:00'), 124);
  return bytes;
}

function pngExifChunk(tiff: Uint8Array) {
  const bytes = new Uint8Array(tiff.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, tiff.length);
  bytes.set(new TextEncoder().encode('eXIf'), 4);
  bytes.set(tiff, 8);
  let crc = -1;
  for (const byte of bytes.subarray(4, bytes.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(bytes.length - 4, ~crc);
  return bytes;
}

export function datedExport(blob: Blob, name: string, date: Date): File {
  const tiff = exifDateBlock(date);
  if (blob.type === 'image/png') {
    return new File([blob.slice(0, 33), pngExifChunk(tiff), blob.slice(33)], name,
      { type: blob.type, lastModified: date.getTime() });
  }
  const length = tiff.length + 8;
  const app1 = new Uint8Array([0xff, 0xe1, length >> 8, length & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  return new File([blob.slice(0, 2), app1, tiff, blob.slice(2)], name,
    { type: blob.type, lastModified: date.getTime() });
}
