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
  // A stale catalogue selection must never resurrect deleted formats or duplicate IDs.
  const liveAvailable = [...new Set(available.filter((id) => typeof id === 'string' && id.trim().length > 0))];
  const valid = new Set(liveAvailable);
  const cleanSelected = [...new Set(selected.filter((id) => valid.has(id)))];
  const anchorIsLive = valid.has(active);
  const cleanActive = anchorIsLive ? active : (cleanSelected[0] ?? liveAvailable[0] ?? '');
  if (!valid.has(target)) return { active: cleanActive, selected: cleanSelected };
  if (shift) {
    // A deleted anchor must not silently expand a range from an unrelated format.
    const anchor = anchorIsLive ? liveAvailable.indexOf(active) : -1;
    const index = liveAvailable.indexOf(target);
    const range = liveAvailable.slice(Math.min(anchor < 0 ? index : anchor, index), Math.max(anchor < 0 ? index : anchor, index) + 1);
    return { active: target, selected: ctrl ? [...new Set([...cleanSelected, ...range])] : [...new Set(range)] };
  }
  return {
    active: target,
    selected: ctrl
      ? (cleanSelected.includes(target) ? cleanSelected.filter((id) => id !== target) : [...cleanSelected, target])
      : [target],
  };
}
