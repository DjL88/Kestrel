/** Section F: each device remembers its own workspace layout; never put this in a photo's recipe or synced catalogue. */
export interface WorkspacePaneState {
  /** When true, editing tools and Photo Info fold into labelled icon rails. */
  folded: boolean;
}
/** Information is always on the *opposite* side from the user's chosen tools. */
export function photoInfoDockSide(hand: 'left' | 'right'): 'left' | 'right' {
  return hand === 'left' ? 'right' : 'left';
}

export const WORKSPACE_PANES_KEY = 'kestrel-workspace-panes-v1';
export const DEFAULT_WORKSPACE_PANES: Readonly<WorkspacePaneState> = { folded: false };

export function parseWorkspacePaneState(raw: string | null): WorkspacePaneState {
  if (!raw) return { ...DEFAULT_WORKSPACE_PANES };
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !('folded' in data) ||
        typeof data.folded !== 'boolean') return { ...DEFAULT_WORKSPACE_PANES };
    return { folded: data.folded };
  } catch {
    return { ...DEFAULT_WORKSPACE_PANES };
  }
}

export function readWorkspacePaneState(storage?: Pick<Storage, 'getItem'> | null): WorkspacePaneState {
  try {
    const store = storage === undefined ? (typeof window === 'undefined' ? null : window.localStorage) : storage;
    return parseWorkspacePaneState(store?.getItem(WORKSPACE_PANES_KEY) ?? null);
  } catch {
    return { ...DEFAULT_WORKSPACE_PANES };
  }
}

export function writeWorkspacePaneState(state: WorkspacePaneState, storage?: Pick<Storage, 'setItem'> | null): void {
  try {
    const store = storage === undefined ? (typeof window === 'undefined' ? null : window.localStorage) : storage;
    store?.setItem(WORKSPACE_PANES_KEY, JSON.stringify({ folded: !!state.folded }));
  } catch {
    // Restricted storage must not prevent offline editing or focus controls.
  }
}

/** The same explicit transition is used by the button and keyboard shortcut. */
export function toggleWorkspacePanes(state: WorkspacePaneState): WorkspacePaneState {
  return { folded: !state.folded };
}
