import { addTags, type SubjectKind } from './subjectTags';
import type { PhotoFrame } from './types';

/** The other photos in the same burst as this one: shots taken a moment apart, usually of the same animal. */
export function burstMates(frames: readonly PhotoFrame[], current: Pick<PhotoFrame, 'id' | 'burstGroupId'>): PhotoFrame[] {
  if (!current.burstGroupId || frames.some((frame) => frame.id === current.id && frame.removedAt != null)) return [];
  return frames.filter((frame) => frame.id !== current.id && frame.burstGroupId === current.burstGroupId && frame.removedAt == null);
}

/** Does this photo already carry the name, as a tag or an older subject name? */
export const hasName = (frame: Pick<PhotoFrame, 'tags' | 'subjectNames'>, name: string) =>
  [...(frame.tags ?? []), ...(frame.subjectNames ?? [])].some((entry) => entry.toLowerCase() === name.toLowerCase());

/** Add a tag to chosen photos, and set the kind where none has been chosen. Everything else is left exactly as it was. */
export function tagFrames(frames: readonly PhotoFrame[], ids: readonly string[], name: string, kind: SubjectKind | undefined): PhotoFrame[] {
  const chosen = new Set(ids);
  return frames.map((frame) => (chosen.has(frame.id) && frame.removedAt == null && !hasName(frame, name)
    ? { ...frame, tags: addTags(frame.tags ?? [], [name]), ...(frame.subjectKind || !kind ? {} : { subjectKind: kind }) } : frame));
}
