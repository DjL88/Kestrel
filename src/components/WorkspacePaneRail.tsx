import { Info, SlidersHorizontal } from './icons/KestrelUIIcons';
import { libraryText as t } from '../i18n/areas/library';

interface WorkspacePaneRailProps {
  kind: 'tools' | 'info';
  side: 'left' | 'right';
  onExpand: () => void;
}

/** Section F: an actual, keyboard-operable docked rail, not a photo-covering popover.
 * These are hidden at phone sizes: the editor's existing bottom sheet provides
 * the same one-tap access without consuming a narrow handset's photo width. */
export function WorkspacePaneRail({ kind, side, onExpand }: WorkspacePaneRailProps) {
  const label = kind === 'tools' ? t.paneRail.editingTools : t.paneRail.photoInfo;
  const expand = kind === 'tools' ? t.paneRail.expandTools : t.paneRail.expandInfo;
  const Icon = kind === 'tools' ? SlidersHorizontal : Info;
  return (
    // A folded pane is a single button, not the panel: not a landmark named like the panel it stands for.
    <div role="group" aria-label={kind === 'tools' ? t.paneRail.foldedTools : t.paneRail.foldedInfo}
      className={`hidden w-12 shrink-0 flex-col items-center gap-2 bg-kestrel-panel py-3 ${kind === 'tools' ? 'workspace:flex' : 'info-dock:flex'} ${side === 'left' ? 'border-r border-white/10' : 'border-l border-white/10'}`}>
      <button type="button" onClick={onExpand}
        aria-label={expand}
        title={expand}
        className="flex h-11 w-11 items-center justify-center rounded-md text-zinc-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </button>
      <span aria-hidden="true" className="select-none text-[10px] font-medium uppercase tracking-wider text-zinc-400 [writing-mode:vertical-rl]">{label}</span>
    </div>
  );
}
