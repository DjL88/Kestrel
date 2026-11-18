/**
 * Read parts of a large original without loading all of it.
 *
 * Import needs only a RAW file's embedded preview and its EXIF. On real Nikon Z8/Z5II NEFs (29 MB on average) that is
 * about 3 MB, but import used to read every whole file through the desktop bridge, 2-3 seconds a photo. A RangeBlob
 * looks enough like a Blob for the preview and EXIF readers (size, slice, arrayBuffer) and fetches only the byte ranges
 * they ask for. `materialize` turns the part that is actually needed into a real Blob for decoding.
 */
export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>;

/** Measured on 120 real NEF/JPEG/DNG/HIF files: EXIF read from the first 1 MiB is identical to reading the whole file. */
export const EXIF_HEAD_BYTES = 1024 * 1024;

export class RangeBlob {
  constructor(
    private readonly read: ReadRange,
    private readonly start: number,
    private readonly end: number,
    readonly type = '',
  ) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      throw new RangeError('Invalid byte range');
    }
  }

  static of(read: ReadRange, size: number, type = ''): RangeBlob {
    return new RangeBlob(read, 0, size, type);
  }

  get size(): number {
    return this.end - this.start;
  }

  /** Same clamping rules as Blob.slice, including negative offsets counted from the end. */
  slice(from = 0, to = this.size, type = ''): RangeBlob {
    const clamp = (value: number) => {
      const whole = Number.isFinite(value) ? Math.trunc(value) : value > 0 ? this.size : 0;
      return Math.min(this.size, Math.max(0, whole < 0 ? this.size + whole : whole));
    };
    const a = clamp(from);
    const b = Math.max(a, clamp(to));
    return new RangeBlob(this.read, this.start + a, this.start + b, type);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.size === 0) return new ArrayBuffer(0);
    const bytes = await this.read(this.start, this.size);
    if (bytes.byteLength !== this.size) throw new Error('The file ended before the expected bytes could be read.');
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
}

/** A real Blob holding exactly these bytes (a Blob is returned unchanged). */
export async function materialize(source: Blob | RangeBlob, type?: string): Promise<Blob> {
  if (source instanceof Blob) return source;
  return new Blob([await source.arrayBuffer()], { type: type ?? source.type });
}

/** The start of a file as a real Blob, for readers that need one, such as the EXIF parser. */
export async function headBlob(source: Blob | RangeBlob, bytes = EXIF_HEAD_BYTES): Promise<Blob> {
  return materialize(source.slice(0, Math.min(source.size, bytes)));
}

/**
 * Open a linked original for ranged reading in the desktop app. Reads are serialised on one handle (seek then read must
 * not interleave). Always call close(), also after an error, so the file handle is released.
 */
export async function openLinkedRange(path: string, size: number, type = ''): Promise<{ blob: RangeBlob; close(): Promise<void> }> {
  const fs = await import('@tauri-apps/plugin-fs');
  const handle = await fs.open(path, { read: true });
  let queue: Promise<unknown> = Promise.resolve();
  const read: ReadRange = (offset, length) => {
    const next = queue.then(async () => {
      await handle.seek(offset, fs.SeekMode.Start);
      const out = new Uint8Array(length);
      let got = 0;
      while (got < length) {
        const count = await handle.read(out.subarray(got));
        if (!count) break;
        got += count;
      }
      return got === length ? out : out.subarray(0, got);
    });
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    blob: RangeBlob.of(read, size, type),
    close: async () => { try { await queue; } finally { await handle.close(); } },
  };
}
