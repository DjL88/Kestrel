import { AppearanceSettings } from './AppearanceSettings';
import { Keyboard } from 'lucide-react';
import { isDesktopApp } from '../providers/desktopShell';

interface Props {
  side: 'left' | 'right';
  onSideChange: (side: 'left' | 'right') => void;
  hand?: 'left' | 'right';
  onHandChange?: (hand: 'left' | 'right') => void;
  onClose: () => void;
  onOpenMacroPad?: () => void;
}

/** One bounded, touch-friendly settings sheet from Home, Library or Editor. */
export function AppearanceDialog({ side, onSideChange, hand, onHandChange, onClose, onOpenMacroPad }: Props) {
  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] workspace:items-center"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="Appearance and layout settings"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
          if (event.key !== 'Tab') return;
          const order = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
          if (!order.length) return;
          const at = order.indexOf(document.activeElement as HTMLElement);
          event.preventDefault();
          order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
        }}
        className="max-h-[85dvh] w-full max-w-md min-w-0 overflow-y-auto rounded-xl border border-white/15 bg-kestrel-panel p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Appearance & layout</h2>
          <button type="button" autoFocus className="min-h-11 rounded-md px-3 text-sm hover:bg-white/10" onClick={onClose}>Done</button>
        </div>
        <AppearanceSettings side={side} onSideChange={onSideChange} hand={hand} onHandChange={onHandChange} />
        {onOpenMacroPad && isDesktopApp() && (
          <button type="button" onClick={() => { onClose(); onOpenMacroPad(); }}
            className="flex min-h-11 w-full items-center gap-2 rounded-md border border-white/15 px-3 text-sm text-zinc-200 hover:bg-white/10">
            <Keyboard className="h-4 w-4" aria-hidden="true" />Macro pad & keyboard shortcuts…
          </button>
        )}
      </section>
    </div>
  );
}
