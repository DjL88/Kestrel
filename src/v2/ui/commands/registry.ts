import { formatChordLabel, normalizeKeyChord, type KeyEventLike } from '../../../core/keyboardCommands';

/**
 * One list of everything the person can ask InFlight to do from the keyboard.
 * The key handler, the shortcut guide, the settings Keyboard tab and (later) the native menu, command search,
 * macro pad and TourBox all read this list, so a command is defined once.
 * Chords use the same names as V1 (`normalizeKeyChord`): "KeyF", "Ctrl+KeyZ", "Digit3".
 * A chord written with "Mod" means Cmd on macOS and Ctrl elsewhere.
 */
export type CommandId =
  | 'help.toggle'
  | 'photo.flag'
  | 'photo.next' | 'photo.prev'
  | 'photo.rate0' | 'photo.rate1' | 'photo.rate2' | 'photo.rate3' | 'photo.rate4' | 'photo.rate5'
  | 'view.grid'
  | 'view.compare'
  | 'view.fullscreen'
  | 'edit.undo' | 'edit.redo'
  | 'edit.copy' | 'edit.paste'
  | 'edit.selectAll'
  | 'file.export'
  | 'app.settings'
  | 'app.commandSearch';

export type CommandGroup = 'photos' | 'view' | 'edit' | 'app';

export interface CommandDefinition {
  id: CommandId;
  group: CommandGroup;
  /** British English label shown in the guide. */
  label: string;
  /** Still works while a text field has focus (Undo is left to the field itself, so it is false). */
  worksInFields: boolean;
  /** A held key repeats the command. Decisions never repeat. */
  allowRepeat: boolean;
}

export const COMMANDS: readonly CommandDefinition[] = [
  { id: 'help.toggle', group: 'app', label: 'Show or hide the keyboard guide', worksInFields: false, allowRepeat: false },
  { id: 'photo.flag', group: 'photos', label: 'Flag or unflag selected photos', worksInFields: false, allowRepeat: false },
  { id: 'photo.next', group: 'photos', label: 'Next photo', worksInFields: false, allowRepeat: true },
  { id: 'photo.prev', group: 'photos', label: 'Previous photo', worksInFields: false, allowRepeat: true },
  { id: 'photo.rate0', group: 'photos', label: 'Clear rating', worksInFields: false, allowRepeat: false },
  { id: 'photo.rate1', group: 'photos', label: 'Rate 1 star', worksInFields: false, allowRepeat: false },
  { id: 'photo.rate2', group: 'photos', label: 'Rate 2 stars', worksInFields: false, allowRepeat: false },
  { id: 'photo.rate3', group: 'photos', label: 'Rate 3 stars', worksInFields: false, allowRepeat: false },
  { id: 'photo.rate4', group: 'photos', label: 'Rate 4 stars', worksInFields: false, allowRepeat: false },
  { id: 'photo.rate5', group: 'photos', label: 'Rate 5 stars', worksInFields: false, allowRepeat: false },
  { id: 'view.grid', group: 'view', label: 'All photos (grid view)', worksInFields: false, allowRepeat: false },
  { id: 'view.compare', group: 'view', label: 'Compare original and edit', worksInFields: false, allowRepeat: false },
  { id: 'view.fullscreen', group: 'view', label: 'Full screen', worksInFields: false, allowRepeat: false },
  { id: 'edit.undo', group: 'edit', label: 'Undo', worksInFields: false, allowRepeat: true },
  { id: 'edit.redo', group: 'edit', label: 'Redo', worksInFields: false, allowRepeat: true },
  { id: 'edit.copy', group: 'edit', label: 'Copy edit settings', worksInFields: false, allowRepeat: false },
  { id: 'edit.paste', group: 'edit', label: 'Paste edit settings', worksInFields: false, allowRepeat: false },
  { id: 'edit.selectAll', group: 'edit', label: 'Select all photos', worksInFields: false, allowRepeat: false },
  { id: 'file.export', group: 'app', label: 'Export', worksInFields: true, allowRepeat: false },
  { id: 'app.settings', group: 'app', label: 'Settings', worksInFields: true, allowRepeat: false },
  { id: 'app.commandSearch', group: 'app', label: 'Find a command', worksInFields: true, allowRepeat: false },
];

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  photos: 'Photos',
  view: 'View',
  edit: 'Edit',
  app: 'App',
};

export function commandById(id: CommandId): CommandDefinition {
  const found = COMMANDS.find((command) => command.id === id);
  if (!found) throw new Error(`Unknown command ${id}`);
  return found;
}

export { formatChordLabel, normalizeKeyChord };
export type { KeyEventLike };
