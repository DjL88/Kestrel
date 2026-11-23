import type { OverlaySettings } from '../ui/contract';
import { readOverlay } from './overlayOps';

/** A saved overlay: the text rows and the watermark with their places, kept on this device and applied to any photos. */
export interface OverlayTemplate { id: string; name: string; overlay: OverlaySettings; savedAt: number }

export const TEMPLATES_KEY = 'inflight-v2-overlay-templates'; // starts with "inflight" so Erase this device removes it
export const MAX_TEMPLATES = 20;
export const MAX_NAME = 40;

const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

/** Read what was saved, defensively: a bad entry is dropped, and every overlay is made valid before it can be applied. */
export function readTemplates(raw: string | null | undefined): OverlayTemplate[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const list: OverlayTemplate[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !/^tpl-[a-z0-9]{3,24}$/.test(item.id) || seen.has(item.id)) continue;
    const name = typeof item.name === 'string' ? cleanName(item.name) : '';
    if (!name) continue;
    seen.add(item.id);
    list.push({ id: item.id, name, overlay: readOverlay(item.overlay), savedAt: typeof item.savedAt === 'number' && Number.isFinite(item.savedAt) ? item.savedAt : 0 });
    if (list.length >= MAX_TEMPLATES) break;
  }
  return list;
}

/** A new template from an overlay, or undefined when the name is empty or the most allowed are already saved. */
export function addTemplate(list: readonly OverlayTemplate[], name: string, overlay: OverlaySettings, id: string, now: number): OverlayTemplate[] | undefined {
  const clean = cleanName(name);
  if (!clean || list.length >= MAX_TEMPLATES || !/^tpl-[a-z0-9]{3,24}$/.test(id) || list.some((entry) => entry.id === id)) return undefined;
  return [...list, { id, name: clean, overlay: readOverlay(JSON.parse(JSON.stringify(overlay))), savedAt: now }];
}

export const renameTemplate = (list: readonly OverlayTemplate[], id: string, name: string): OverlayTemplate[] => {
  const clean = cleanName(name);
  return clean ? list.map((entry) => (entry.id === id ? { ...entry, name: clean } : entry)) : [...list];
};

export const deleteTemplate = (list: readonly OverlayTemplate[], id: string): OverlayTemplate[] => list.filter((entry) => entry.id !== id);

/** The overlay a photo gets from a template. A copy, so changing the photo later never changes the template. */
export const overlayFromTemplate = (template: OverlayTemplate): OverlaySettings => readOverlay(JSON.parse(JSON.stringify(template.overlay)));
