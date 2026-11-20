import type { CullDecision } from './types';

/**
 * The actions in the right-click menu on a photo (grid or filmstrip). One list decides what is offered and when it is
 * greyed out, so the menu, its tests and the handlers agree. Backup and recovery never depend on a licence.
 */
export type PhotoAction =
  | 'edit' | 'info' | 'keep' | 'trash' | 'unreview'
  | 'rate1' | 'rate2' | 'rate3' | 'rate4' | 'rate5' | 'rate0'
  | 'copy' | 'paste' | 'reset' | 'duplicate' | 'export' | 'remove';

export interface PhotoMenuItem {
  action: PhotoAction;
  label: string;
  disabled?: boolean;
  /** Items sharing a group sit together; a gap separates groups. */
  group: number;
  /** Shown in a row of five rather than a list, for the star ratings. */
  inline?: boolean;
}

export interface PhotoMenuState {
  decision: CullDecision;
  /** How many photos the action applies to: more than one when the photo is part of a selection. */
  count: number;
  /** Adjustments have been copied and can be pasted. */
  canPaste: boolean;
  /** Whether this photo has any adjustments to copy. */
  hasEdit: boolean;
  /** Whether the photo has been changed from its original (what Reset undoes). Optional so older callers stay valid. */
  edited?: boolean;
}

const plural = (count: number) => (count > 1 ? ` (${count} photos)` : '');

export function photoMenuItems(state: PhotoMenuState): PhotoMenuItem[] {
  const many = state.count > 1;
  const items: PhotoMenuItem[] = [
    { action: 'edit', label: 'Edit photo', group: 0, disabled: many },
    { action: 'info', label: 'Photo info', group: 0, disabled: many },
    { action: 'keep', label: `Pick${plural(state.count)}`, group: 1, disabled: state.decision === 'keep' && !many },
    { action: 'trash', label: `Reject${plural(state.count)}`, group: 1, disabled: state.decision === 'reject' && !many },
    { action: 'unreview', label: `Unmark${plural(state.count)}`, group: 1, disabled: state.decision === 'unreviewed' && !many },
    ...([1, 2, 3, 4, 5] as const).map((stars) => ({ action: `rate${stars}` as PhotoAction, label: `Rate ${stars} star${stars > 1 ? 's' : ''}${plural(state.count)}`, group: 2, inline: true })),
    { action: 'rate0', label: `Clear rating${plural(state.count)}`, group: 2 },
    { action: 'copy', label: 'Copy adjustments', group: 3, disabled: many || !state.hasEdit },
    { action: 'paste', label: `Paste adjustments${plural(state.count)}`, group: 3, disabled: !state.canPaste },
    { action: 'reset', label: `Reset edit${plural(state.count)}…`, group: 3, disabled: !state.edited },
    // A virtual copy has its own edits and decision and points at the same original file. It never copies the file.
    { action: 'duplicate', label: 'Duplicate (virtual copy)', group: 3, disabled: many },
    { action: 'export', label: `Export${plural(state.count)}…`, group: 4 },
  ];
  // Removing from the library only applies to photos already rejected. Rejecting itself never removes a photo.
  if (state.decision === 'reject') items.push({ action: 'remove', label: `Remove from library${plural(state.count)}`, group: 4 });
  return items;
}

/** The star count an action sets, or null for other actions. */
export function ratingFor(action: PhotoAction): number | null {
  const match = /^rate([0-5])$/.exec(action);
  return match ? Number(match[1]) : null;
}

/** Which photos an action applies to: the whole selection when the photo clicked is part of it, otherwise just that photo. */
export function targetsFor(frameId: string, selected: ReadonlySet<string>, selectionMode: boolean): string[] {
  return selectionMode && selected.size > 1 && selected.has(frameId) ? [...selected] : [frameId];
}
