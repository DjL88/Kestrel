import { safeExportName } from './exportPlace';
import { uniqueExportFilename } from './exportNaming';
import type { PhotoFrame } from './types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

export const BROWSER_ORIGINAL_ZIP_LIMIT = 128_000_000;

/**
 * A source copy is NEVER rendered through Kestrel's JPEG/PNG/RAW developing
 * pipeline. A File wrapper changes the safe destination name/timestamp only;
 * Blob bytes, embedded EXIF/GPS, format and compression are untouched.
 */
export function originalCopyFilename(filename: string): string {
  if (typeof filename !== 'string' || !filename.trim() || filename === '.' || filename === '..')
    throw new Error('The original has no safe filename.');
  const name = safeExportName(filename).replace(/^[.\-]+/, '').replace(/[. ]+$/, '');
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  if (!name || !stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem))
    throw new Error('The original has a reserved filename. Rename its export copy before saving.');
  return name;
}

export interface OriginalCopyEntry {
  readonly sourceId: string;
  readonly filename: string;
  readonly subfolder: string;
}

/** Duplicate camera names are resolved before any bytes are read or written. */
export function planOriginalCopies(frames: readonly Pick<PhotoFrame, 'id' | 'filename' | 'stableKey' | 'isDemo'>[]): OriginalCopyEntry[] {
  if (!frames.length) throw new Error('Choose a photo before saving originals.');
  const used = new Set<string>();
  return frames.map(frame => {
    if (frame.isDemo || !frame.stableKey) throw new Error('Demo photos have no original file to copy.');
    return {
      sourceId: frame.id,
      filename: uniqueExportFilename(originalCopyFilename(frame.filename), used),
      subfolder: 'Original',
    };
  });
}

export async function copyUnchangedOriginal(
  frame: Pick<PhotoFrame, 'filename' | 'stableKey' | 'isDemo'>,
  provider: Pick<BrowserPreviewProvider, 'ensureOriginal' | 'originalInfo'>,
  filename: string,
  signal?: AbortSignal,
): Promise<File> {
  if (frame.isDemo || !frame.stableKey) throw new Error('A demo has no camera original to save.');
  const name = originalCopyFilename(filename);
  signal?.throwIfAborted();
  // Capture the linked source's size BEFORE reading it. A file swapped or
  // truncated while reattaching a drive must not be passed off as the original.
  const expected = provider.originalInfo(frame.stableKey);
  const original = await provider.ensureOriginal(frame.stableKey, 'background');
  signal?.throwIfAborted();
  if (!original || original.size === 0)
    throw new Error(`Reconnect ${frame.filename} to save its actual original file. A cached preview is not enough.`);
  if (expected && original.size !== expected.size)
    throw new Error(`The original ${frame.filename} changed while being read. Reconnect and check it before copying.`);
  const stamp = expected?.lastModified;
  const lastModified = typeof stamp === 'number' && Number.isFinite(stamp) && stamp > 0
    ? stamp : (original instanceof File ? original.lastModified : Date.now());
  return new File([original], name, { type: original.type, lastModified });
}
