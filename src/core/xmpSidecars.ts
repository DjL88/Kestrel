import { zipSync } from 'fflate';
import { safeExportName } from './exportPlace';
import { photoSidecar } from './photoSidecar';
import type { PhotoFrame } from './types';

/** Sidecar names must still match the originals when unpacked by the photographer. */
export function makeXmpDownload(frames: readonly PhotoFrame[]): { blob: Blob; name: string } | null {
  const entries: Record<string, Uint8Array> = Object.create(null);
  const names = new Set<string>();
  for (const frame of frames) {
    if (frame.isDemo || frame.virtualCopy) continue;
    const stem = frame.filename.replace(/\.[^.]+$/, '');
    const name = stem + '.xmp';
    const key = name.normalize('NFC').toLowerCase();
    if (!stem || safeExportName(name) !== name || names.has(key) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) return null;
    names.add(key);
    const sidecar = photoSidecar(frame);
    if (sidecar.filename !== name) return null;
    entries[name] = sidecar.bytes;
  }

  const filenames = Object.keys(entries);
  if (!filenames.length) return null;
  if (filenames.length === 1) {
    const name = filenames[0];
    return { name, blob: new Blob([new Uint8Array(entries[name])], { type: 'application/rdf+xml' }) };
  }
  return {
    name: 'kestrel-xmp-sidecars.zip',
    blob: new Blob([new Uint8Array(zipSync(entries, { level: 0 }))], { type: 'application/zip' }),
  };
}
