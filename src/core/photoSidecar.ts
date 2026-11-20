import { safeExportName } from './exportPlace';
import { sidecarXmpPacket } from './tiffExportMetadata';
import type { PhotoFrame } from './types';

export function photoSidecar(frame: PhotoFrame) {
  const base = frame.filename.replace(/\.[^.]+$/, '');
  const suffix = frame.virtualCopy ? `-copy-${frame.virtualCopy.number}` : '';
  const stem = safeExportName(base).slice(0, 140 - suffix.length);
  const automated = new Set(frame.autoTags?.map(tag => tag.trim().toLowerCase()));
  const keywords = [...(frame.subjectNames ?? []), ...(frame.tags ?? [])]
    .filter(tag => !automated.has(tag.trim().toLowerCase()));
  const pick = frame.decision === 'keep' ? 1 : frame.decision === 'reject' ? -1 : 0;
  return {
    filename: stem + suffix + '.xmp',
    bytes: sidecarXmpPacket(frame.rating ?? frame.exif.rating ?? 0, pick, keywords),
  };
}
