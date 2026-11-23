/** Selection behaviour shared by the All Formats board and the normal format controls. */
export interface FormatSelectionInput {
  available: readonly string[];
  selected: readonly string[];
  active: string;
  target: string;
  /** Shift includes the contiguous range from the current anchor to the clicked format. */
  shift?: boolean;
  /** Ctrl/Cmd toggles one format; with Shift it adds the range to the selection. */
  ctrl?: boolean;
}

/**
 * Normalise persisted selections against the current format board.
 * Deleted formats and duplicate IDs must not leak into multi-format operations.
 */
function liveFormats(available: readonly string[]): string[] {
  return [...new Set(available.filter((id) => typeof id === 'string' && id.trim().length > 0))];
}

function validSelection(available: readonly string[], selected: readonly string[]): string[] {
  const valid = new Set(available);
  return [...new Set(selected.filter((id) => valid.has(id)))];
}

export function chooseFormatSelection({
  available, selected, active, target, shift = false, ctrl = false,
}: FormatSelectionInput): { active: string; selected: string[] } {
  const formats = liveFormats(available);
  const current = validSelection(formats, selected);
  const valid = new Set(formats);
  const hasLiveAnchor = valid.has(active);
  const safeActive = hasLiveAnchor ? active : (current[0] ?? formats[0] ?? '');

  // An unavailable target is a no-op, except it must not resurrect deleted
  // format IDs from a saved project or a stale UI selection.
  if (!valid.has(target)) return { active: safeActive, selected: current };
  if (shift) {
    // If the anchor was deleted, select only the clicked target. Do not
    // silently create a range starting at an unrelated surviving format.
    const anchor = hasLiveAnchor ? formats.indexOf(active) : -1;
    const index = formats.indexOf(target);
    const start = anchor < 0 ? index : Math.min(anchor, index);
    const end = anchor < 0 ? index : Math.max(anchor, index);
    const range = formats.slice(start, end + 1);
    return { active: target, selected: ctrl ? [...new Set([...current, ...range])] : range };
  }
  return {
    active: target,
    selected: ctrl
      ? (current.includes(target) ? current.filter((id) => id !== target) : [...current, target])
      : [target],
  };
}
