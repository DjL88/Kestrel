/**
 * Which native desktop menu items (src-tauri/src/app_menu.rs) can act right now. Items that cannot are greyed out, never
 * hidden, so the menus keep the same shape on every screen. Pure, so the rules are tested without a desktop build.
 */
export interface MenuContext {
  /** A project is open (the editor screen), not the projects list. */
  inEditor: boolean;
  /** The open project is a collage, not a set of photos. */
  collage: boolean;
  /** Photos in the open project. */
  photoCount: number;
  /** Photos the person selected (filmstrip or grid). */
  selectedCount: number;
  /** A photo is in view. */
  hasActivePhoto: boolean;
  /** The grid of all photos is showing. */
  gridOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Copy edits has been used, so there is something to paste. */
  hasCopiedEdits: boolean;
  /** Someone else is editing this shared photo, so edits are view only. */
  editLocked: boolean;
}

export type MenuState = Record<string, boolean>;

/** Every custom id whose state the page controls. Settings, Help and the system items are always available. */
export function menuState(c: MenuContext): MenuState {
  const project = c.inEditor;
  const photos = project && !c.collage && c.photoCount > 0;
  // Ratings and decisions act on the selection, or on the photo in view when nothing is selected.
  const target = photos && (c.selectedCount > 0 || c.hasActivePhoto);
  const editable = photos && c.hasActivePhoto && !c.editLocked;
  const state: MenuState = {
    // File
    export: project && (c.collage || c.photoCount > 0),
    'export-again': photos && c.hasActivePhoto,
    'open-export': photos,
    'xmp-save': photos,
    'xmp-read': photos,
    'lightroom-read': project && !c.collage,
    'backup-now': project && !c.collage,
    'backup-file': project && !c.collage,
    'removed-photos': project && !c.collage,
    'back-to-projects': project,
    // Edit
    'photos-select-all': photos,
    'photos-deselect-all': photos && c.selectedCount > 0,
    'edit-copy-adjustments': photos && c.hasActivePhoto,
    'edit-paste-adjustments': target && c.hasCopiedEdits && !c.editLocked,
    'reset-photo': editable,
    // Photo
    'photo-keep': target,
    'photo-reject': target,
    'photo-unreview': target,
    'photo-rate': target,
    'photo-compare': photos && c.hasActivePhoto,
    'photo-undo': project && c.canUndo,
    'photo-redo': project && c.canRedo,
    // View
    'view-grid': photos,
    'view-loupe': photos && c.gridOpen,
    filmstrip: photos,
    'view-fullscreen': true,
    // Help
    'help-shortcuts': project,
  };
  return state;
}

/** Only the items whose state differs from what the menu already shows (everything, the first time). */
export function menuStateChanges(shown: MenuState | null, next: MenuState): [string, boolean][] {
  return Object.entries(next).filter(([id, enabled]) => shown?.[id] !== enabled);
}
