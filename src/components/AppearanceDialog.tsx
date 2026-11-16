import { AppearanceSettings } from './AppearanceSettings';

interface Props {
  side: 'left' | 'right';
  onSideChange: (side: 'left' | 'right') => void;
  onClose: () => void;
}

/** One bounded, touch-friendly settings sheet from Home, Library or Editor. */
export function AppearanceDialog({ side, onSideChange, onClose }: Props) {
  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] workspace:items-center"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="Appearance and layout settings"
        onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
        className="max-h-[85dvh] w-full max-w-md min-w-0 overflow-y-auto rounded-xl border border-white/15 bg-kestrel-panel p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Appearance & layout</h2>
          <button type="button" autoFocus className="min-h-11 rounded-md px-3 text-sm hover:bg-white/10" onClick={onClose}>Done</button>
        </div>
        <AppearanceSettings side={side} onSideChange={onSideChange} />
      </section>
    </div>
  );
}
