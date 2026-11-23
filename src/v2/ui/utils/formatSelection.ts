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
function validSelection(available: readonly string[], selected: readonly string[]): string[] {
  const valid = new Set(available);
  return [...new Set(selected.filter((id) => valid.has(id)))];
}

export function chooseFormatSelection({
  available, selected, active, target, shift = false, ctrl = false,
}: FormatSelectionInput): { active: string; selected: string[] } {
  if (!available.includes(target)) return { active, selected: [...selected] };
  const current = validSelection(available, selected);
  if (shift) {
    const anchor = available.indexOf(active);
    const index = available.indexOf(target);
    const start = anchor < 0 ? index : Math.min(anchor, index);
    const end = anchor < 0 ? index : Math.max(anchor, index);
    const range = [...new Set(available.slice(start, end + 1))];
    return { active: target, selected: ctrl ? [...new Set([...current, ...range])] : range };
  }
  return {
    active: target,
    selected: ctrl ? (current.includes(target) ? current.filter((id) => id !== target) : [...current, target]) : [target],
  };
}
