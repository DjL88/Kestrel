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
  | 'photo.flag' | 'photo.reject' | 'photo.unflag'
  | 'photo.next' | 'photo.prev'
  | 'photo.nextToReview' | 'photo.prevToReview'
  | 'photo.rate0' | 'photo.rate1' | 'photo.rate2' | 'photo.rate3' | 'photo.rate4' | 'photo.rate5'
  | 'photo.rateUp' | 'photo.rateDown'
  | 'view.grid' | 'view.loupe' | 'view.filmstrip'
  | 'view.compare'
  | 'view.fullscreen'
  | 'view.maskOverlay'
  | 'view.zoomIn' | 'view.zoomOut' | 'view.zoomFit' | 'view.zoom100'
  | 'adjust.sliderUp' | 'adjust.sliderDown' | 'adjust.sliderUpMore' | 'adjust.sliderDownMore'
  | 'edit.undo' | 'edit.redo'
  | 'edit.copy' | 'edit.paste'
  | 'edit.selectAll' | 'edit.selectNone'
  | 'file.export'
  | 'app.settings'
  | 'app.commandSearch';

export type CommandGroup = 'photos' | 'view' | 'adjust' | 'edit' | 'app';

export interface CommandDefinition {
  id: CommandId;
  group: CommandGroup;
  /** British English label shown in the guide. */
  label: string;
  /** Still works while a text field has focus (Undo is left to the field itself, so it is false). */
  worksInFields: boolean;
  /** A held key repeats the command. Decisions never repeat. */
  allowRepeat: boolean;
  /** A preview feature: the command exists only while this feature is on (hidden from the guide, search and keys otherwise). */
  preview?: 'nextToReview';
}

export const COMMANDS: readonly CommandDefinition[] = [
  { id: 'help.toggle', group: 'app', label: 'Show or hide the keyboard guide', worksInFields: false, allowRepeat: false },
  { id: 'photo.flag', group: 'photos', label: 'Flag or unflag selected photos', worksInFields: false, allowRepeat: false },
  { id: 'photo.reject', group: 'photos', label: 'Set aside selected photos', worksInFields: false, allowRepeat: false },
  { id: 'photo.unflag', group: 'photos', label: 'Clear flag or set aside', worksInFields: false, allowRepeat: false },
  { id: 'photo.next', group: 'photos', label: 'Next photo', worksInFields: false, allowRepeat: true },
  { id: 'photo.prev', group: 'photos', label: 'Previous photo', worksInFields: false, allowRepeat: true },
  { id: 'photo.nextToReview', group: 'photos', label: 'Next photo to review', worksInFields: false, allowRepeat: true, preview: 'nextToReview' },
  { id: 'photo.prevToReview', group: 'photos', label: 'Previous photo to review', worksInFields: false, allowRepeat: true, preview: 'nextToReview' },
  { id: 'photo.rate0', group: 'photos', label: 'Clear rating', worksInFields: false, allowRepeat: false },
  { id: 'photo.rate1', group: 'photos', label: 'Rate 1 star', worksInFields: false, allowRepeat: false },
  { id: 'photo.rate2', group: 'photos', label: 'Rate 2 stars', worksInFields: false, allowRepeat: false },
  { id: 'photo.rate3', group: 'photos', label: 'Rate 3 stars', worksInFields: false, allowRepeat: false },
  { id: 'photo.rate4', group: 'photos', label: 'Rate 4 stars', worksInFields: false, allowRepeat: false },
  { id: 'photo.rate5', group: 'photos', label: 'Rate 5 stars', worksInFields: false, allowRepeat: false },
  // For a controller's D-pad or a dial: one star more or fewer than the photo in view has. No key by default.
  { id: 'photo.rateUp', group: 'photos', label: 'One more star', worksInFields: false, allowRepeat: false },
  { id: 'photo.rateDown', group: 'photos', label: 'One fewer star', worksInFields: false, allowRepeat: false },
  { id: 'view.grid', group: 'view', label: 'All photos (grid view)', worksInFields: false, allowRepeat: false },
  { id: 'view.loupe', group: 'view', label: 'Single photo (close the grid)', worksInFields: false, allowRepeat: false },
  { id: 'view.filmstrip', group: 'view', label: 'Show or hide the filmstrip', worksInFields: false, allowRepeat: false },
  { id: 'view.compare', group: 'view', label: 'Compare original and edit', worksInFields: false, allowRepeat: false },
  { id: 'view.fullscreen', group: 'view', label: 'Full screen', worksInFields: false, allowRepeat: false },
  { id: 'view.maskOverlay', group: 'view', label: 'Show or hide the selected mask overlay', worksInFields: false, allowRepeat: false },
  { id: 'view.zoomIn', group: 'view', label: 'Zoom in', worksInFields: false, allowRepeat: true },
  { id: 'view.zoomOut', group: 'view', label: 'Zoom out', worksInFields: false, allowRepeat: true },
  { id: 'view.zoomFit', group: 'view', label: 'Zoom to fit', worksInFields: false, allowRepeat: false },
  { id: 'view.zoom100', group: 'view', label: 'Zoom to 100% (again for fit)', worksInFields: false, allowRepeat: false },
  // For dials and pad keys (TourBox, Loupedeck, a pad's knob): turn the slider last used, or Exposure. No key by default.
  { id: 'adjust.sliderUp', group: 'adjust', label: 'Slider in use: up one step', worksInFields: false, allowRepeat: true },
  { id: 'adjust.sliderDown', group: 'adjust', label: 'Slider in use: down one step', worksInFields: false, allowRepeat: true },
  { id: 'adjust.sliderUpMore', group: 'adjust', label: 'Slider in use: up ten steps', worksInFields: false, allowRepeat: true },
  { id: 'adjust.sliderDownMore', group: 'adjust', label: 'Slider in use: down ten steps', worksInFields: false, allowRepeat: true },
  { id: 'edit.undo', group: 'edit', label: 'Undo', worksInFields: false, allowRepeat: true },
  { id: 'edit.redo', group: 'edit', label: 'Redo', worksInFields: false, allowRepeat: true },
  { id: 'edit.copy', group: 'edit', label: 'Copy edit settings', worksInFields: false, allowRepeat: false },
  { id: 'edit.paste', group: 'edit', label: 'Paste edit settings', worksInFields: false, allowRepeat: false },
  { id: 'edit.selectAll', group: 'edit', label: 'Select all photos', worksInFields: false, allowRepeat: false },
  { id: 'edit.selectNone', group: 'edit', label: 'Select no photos', worksInFields: false, allowRepeat: false },
  { id: 'file.export', group: 'app', label: 'Export', worksInFields: true, allowRepeat: false },
  { id: 'app.settings', group: 'app', label: 'Settings', worksInFields: true, allowRepeat: false },
  { id: 'app.commandSearch', group: 'app', label: 'Find a command', worksInFields: true, allowRepeat: false },
];

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  photos: 'Photos',
  view: 'View',
  adjust: 'Adjust',
  edit: 'Edit',
  app: 'App',
};

/** The commands a person can use now: every ordinary command, plus a preview's commands only while that preview is on. */
export function availableCommands(previews: Partial<Record<NonNullable<CommandDefinition['preview']>, boolean>> = {}): CommandDefinition[] {
  return COMMANDS.filter((command) => !command.preview || previews[command.preview] === true);
}

export function commandById(id: CommandId): CommandDefinition {
  const found = COMMANDS.find((command) => command.id === id);
  if (!found) throw new Error(`Unknown command ${id}`);
  return found;
}

export { formatChordLabel, normalizeKeyChord };
export type { KeyEventLike };
