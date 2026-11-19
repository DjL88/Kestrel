import { Info, SlidersHorizontal } from 'lucide-react';

interface WorkspacePaneRailProps {
  kind: 'tools' | 'info';
  side: 'left' | 'right';
  onExpand: () => void;
}

/** Section F: an actual, keyboard-operable docked rail, not a photo-covering popover.
 * These are hidden at phone sizes: the editor's existing bottom sheet provides
 * the same one-tap access without consuming a narrow handset's photo width. */
export function WorkspacePaneRail({ kind, side, onExpand }: WorkspacePaneRailProps) {
  const label = kind === 'tools' ? 'Editing tools' : 'Photo info';
  const Icon = kind === 'tools' ? SlidersHorizontal : Info;
  return (
    <aside aria-label={`${label} collapsed`}
      className={`hidden w-12 shrink-0 flex-col items-center gap-2 bg-kestrel-panel py-3 lg:flex ${side === 'left' ? 'border-r border-white/10' : 'border-l border-white/10'}`}>
      <button type="button" onClick={onExpand}
        aria-label={`Expand ${label.toLowerCase()}`}
        title={`Expand ${label.toLowerCase()}`}
        className="flex h-11 w-11 items-center justify-center rounded-md text-zinc-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </button>
      <span aria-hidden="true" className="select-none text-[10px] font-medium uppercase tracking-wider text-zinc-400 [writing-mode:vertical-rl]">{label}</span>
    </aside>
  );
}
