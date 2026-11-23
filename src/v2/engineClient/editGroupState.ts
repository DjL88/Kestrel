import type { PhotoEdit } from '../../core/photoEdits';
import type { EditHistory } from '../../core/editHistory';
import type { PhotoFrame } from '../../core/types';

/** Persisted V2 edit groups. Only non-destructive recipes and names are stored, never image bytes. */
export interface SavedEditGroup { id: string; name: string; edit?: PhotoEdit; editHistory?: EditHistory }
export interface SavedEditGroups { activeId: string; groups: SavedEditGroup[] }
type GroupFrame = PhotoFrame & { v2EditGroups?: unknown };
const PRIMARY = 'group-primary';
const MAX_GROUPS = 12;
const validId = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9-]{1,64}$/.test(s);
const validName = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 80;

export function readEditGroups(frame: PhotoFrame): SavedEditGroups {
  const raw = (frame as GroupFrame).v2EditGroups;
  const fallback: SavedEditGroups = { activeId: PRIMARY, groups: [{ id: PRIMARY, name: 'Edit group 1', edit: frame.edit, editHistory: frame.editHistory }] };
  if (!raw || typeof raw !== 'object') return fallback;
  const value = raw as Partial<SavedEditGroups>;
  if (!Array.isArray(value.groups) || value.groups.length < 1 || value.groups.length > MAX_GROUPS) return fallback;
  const seen = new Set<string>();
  const groups: SavedEditGroup[] = [];
  for (const candidate of value.groups) {
    if (!candidate || !validId(candidate.id) || !validName(candidate.name) || seen.has(candidate.id)) return fallback;
    seen.add(candidate.id);
    groups.push({ id: candidate.id, name: candidate.name.trim(), edit: candidate.id === value.activeId ? frame.edit : candidate.edit,
      editHistory: candidate.id === value.activeId ? frame.editHistory : candidate.editHistory });
  }
  if (!validId(value.activeId) || !seen.has(value.activeId)) return fallback;
  return { activeId: value.activeId, groups };
}

/** Save the outgoing group's latest recipe whenever a normal slider or mask edit is committed. */
export function syncEditGroup(frame: PhotoFrame): PhotoFrame {
  if (!(frame as GroupFrame).v2EditGroups) return frame;
  const saved = readEditGroups(frame);
  return { ...frame, v2EditGroups: { ...saved, groups: saved.groups.map(group =>
    group.id === saved.activeId ? { ...group, edit: frame.edit, editHistory: frame.editHistory } : group) } };
}

export function addSavedEditGroup(frame: PhotoFrame, id: string): PhotoFrame | null {
  const saved = readEditGroups(frame);
  if (!validId(id) || saved.groups.some(group => group.id === id) || saved.groups.length >= MAX_GROUPS) return null;
  const persisted = syncEditGroup(frame);
  const before = readEditGroups(persisted);
  const next: SavedEditGroups = { activeId: id, groups: [...before.groups, {
    id, name: `Edit group ${before.groups.length + 1}`, edit: persisted.edit,
    // Start a new independent timeline at the inherited recipe, not the parent's old undo steps.
    editHistory: undefined,
  }] };
  return { ...persisted, v2EditGroups: next };
}

export function selectSavedEditGroup(frame: PhotoFrame, id: string): PhotoFrame | null {
  const saved = readEditGroups(frame);
  if (!saved.groups.some(group => group.id === id)) return null;
  if (saved.activeId === id) return frame;
  const persisted = syncEditGroup(frame);
  const next = readEditGroups(persisted);
  const target = next.groups.find(group => group.id === id)!;
  return { ...persisted, edit: target.edit, editHistory: target.editHistory,
    v2EditGroups: { ...next, activeId: id } };
}

export function renameSavedEditGroup(frame: PhotoFrame, id: string, name: string): PhotoFrame | null {
  const saved = readEditGroups(frame);
  if (!validName(name) || !saved.groups.some(group => group.id === id)) return null;
  return { ...frame, v2EditGroups: { ...saved, groups: saved.groups.map(group =>
    group.id === id ? { ...group, name: name.trim() } : group) } };
}
