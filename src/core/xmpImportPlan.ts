import { unzipSync } from 'fflate';
import { photoSidecar, readPhotoSidecar, type ImportedPhotoSidecar } from './photoSidecar';
import type { PhotoFrame } from './types';

const MAX_SINGLE_XMP = 1024 * 1024;
const MAX_ZIP_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_XMP = 16 * 1024 * 1024;
const MAX_FILES = 500;

export type SidecarImportFailure = 'empty' | 'oversize' | 'unsafe' | 'ambiguous' | 'no-match' | 'keeper';
export class SidecarImportError extends Error {
  constructor(readonly reason: SidecarImportFailure) {
    super(reason);
    this.name = 'SidecarImportError';
  }
}
export interface SidecarImport {
  frameId: string;
  metadata: ImportedPhotoSidecar;
}

/** A sidecar identifies a source by basename only, so RAW+JPEG with the same
 * basename cannot be safely matched automatically. Preserve user decisions.
 * File and ZIP inputs are parsed completely before applying any changes.
 */
export async function planXmpImports(
  files: readonly File[],
  selectedFrames: readonly PhotoFrame[],
  allFrames: readonly PhotoFrame[],
  parse: typeof readPhotoSidecar = readPhotoSidecar,
): Promise<SidecarImport[]> {
  if (!files.length || !selectedFrames.length) throw new SidecarImportError('empty');
  if (files.length > MAX_FILES) throw new SidecarImportError('oversize');

  const chosen = new Set(selectedFrames.map(frame => frame.id));
  const lookup = new Map<string, PhotoFrame | null>();
  for (const frame of allFrames) {
    if (frame.isDemo || frame.virtualCopy || frame.removedAt != null) continue;
    const filename = photoSidecar(frame).filename;
    if (!validName(filename)) continue;
    const key = filename.normalize('NFC').toLowerCase();
    if (lookup.has(key)) lookup.set(key, null);
    else lookup.set(key, frame);
  }

  const oneZip = files.length === 1 && /\.zip$/i.test(files[0].name);
  if (!oneZip && files.some(file => !/\.xmp$/i.test(file.name))) throw new SidecarImportError('unsafe');
  const staged: File[] = [];
  if (oneZip) {
    const zipped = files[0];
    if (zipped.size === 0 || zipped.size > MAX_ZIP_BYTES) throw new SidecarImportError('oversize');
    let count = 0;
    let total = 0;
    let data: Record<string, Uint8Array>;
    try {
      data = unzipSync(new Uint8Array(await zipped.arrayBuffer()), {
        // fflate's filter runs BEFORE decompression. Reject malformed size,
        // nested paths, unknown types and oversized archives to bound memory.
        filter(entry) {
          count++;
          if (count > MAX_FILES || entry.originalSize > MAX_SINGLE_XMP ||
              !Number.isSafeInteger(entry.originalSize) || entry.originalSize < 1 ||
              !validName(entry.name) || entry.compression !== 0 && entry.compression !== 8) {
            throw new SidecarImportError('unsafe');
          }
          total += entry.originalSize;
          if (total > MAX_TOTAL_XMP) throw new SidecarImportError('oversize');
          return true;
        },
      });
    } catch (error) {
      if (error instanceof SidecarImportError) throw error;
      throw new SidecarImportError('unsafe');
    }
    for (const [name, bytes] of Object.entries(data)) {
      if (bytes.length > MAX_SINGLE_XMP || !bytes.length) throw new SidecarImportError('oversize');
      staged.push(new File([new Uint8Array(bytes)], name, { type: 'application/rdf+xml' }));
    }
  } else {
    let total = 0;
    for (const file of files) {
      if (!validName(file.name) || file.size < 1 || file.size > MAX_SINGLE_XMP) throw new SidecarImportError('unsafe');
      total += file.size;
      if (total > MAX_TOTAL_XMP) throw new SidecarImportError('oversize');
      staged.push(file);
    }
  }

  // Validate the whole set before any file reaches the XMP parser, so an
  // ambiguous batch is refused without partial work.
  const seen = new Set<string>();
  for (const file of staged) {
    const key = file.name.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new SidecarImportError('ambiguous');
    seen.add(key);
  }
  const plans: SidecarImport[] = [];
  for (const file of staged) {
    const key = file.name.normalize('NFC').toLowerCase();
    if (!lookup.has(key)) continue; // unrelated sidecar in a ZIP: never import it
    const frame = lookup.get(key);
    if (!frame) throw new SidecarImportError('ambiguous'); // RAW+JPEG collision
    if (!chosen.has(frame.id)) continue; // only explicitly selected photographs
    let metadata: ImportedPhotoSidecar;
    try { metadata = await parse(file, frame); }
    catch { throw new SidecarImportError('unsafe'); }
    // An automated batch must not quietly convert an explicitly kept photo
    // into Reject. Review that photo individually, where the person can decide.
    if (frame.decision === 'keep' && metadata.decision === 'reject') {
      throw new SidecarImportError('keeper');
    }
    plans.push({ frameId: frame.id, metadata });
  }
  if (!plans.length) throw new SidecarImportError('no-match');
  return plans;
}

function validName(name: string): boolean {
  return name.length > 4 && name.length <= 255 &&
    /\.xmp$/i.test(name) &&
    !/[\\/\u0000-\u001f]/.test(name) &&
    name !== '.' && name !== '..' &&
    !/^\.+/.test(name) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}
