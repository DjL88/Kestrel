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

export function chooseFormatSelection({
  available, selected, active, target, shift = false, ctrl = false,
}: FormatSelectionInput): { active: string; selected: string[] } {
  if (!available.includes(target)) return { active, selected: [...selected] };
  if (shift) {
    const anchor = available.indexOf(active);
    const index = available.indexOf(target);
    const range = available.slice(Math.min(anchor < 0 ? index : anchor, index), Math.max(anchor < 0 ? index : anchor, index) + 1);
    return { active: target, selected: ctrl ? [...new Set([...selected, ...range])] : range };
  }
  return {
    active: target,
    selected: ctrl ? (selected.includes(target) ? selected.filter((id) => id !== target) : [...selected, target]) : [target],
  };
}