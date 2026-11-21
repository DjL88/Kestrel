import { AppearanceSettings } from './AppearanceSettings';
import type { GuidanceMode } from '../core/guidanceMode';
import { ConnectionsPanel } from './ConnectionsPanel';
import { Keyboard } from 'lucide-react';
import { useState } from 'react';
import { AiProviderSetup } from './AiReviewPanel';
import { useAiSettings } from '../providers/aiSettings';
import { isDesktopApp } from '../providers/desktopShell';
import { messages as m } from '../i18n/messages';

interface Props {
  side: 'left' | 'right';
  onSideChange: (side: 'left' | 'right') => void;
  hand?: 'left' | 'right';
  onHandChange?: (hand: 'left' | 'right') => void;
  guidanceMode?: GuidanceMode;
  onGuidanceModeChange?: (mode: GuidanceMode) => void;
  initialSection?: 'general' | 'ai' | 'storage';
  onClose: () => void;
  onOpenMacroPad?: () => void;
}

/** One bounded, touch-friendly settings sheet from Home, Library or Editor. */
export function AppearanceDialog({ side, onSideChange, hand, onHandChange, guidanceMode = 'glide', onGuidanceModeChange, onClose, onOpenMacroPad, initialSection = 'general' }: Props) {
  const aiSettings = useAiSettings();
  const [aiSetupOpen, setAiSetupOpen] = useState(initialSection === 'ai');
  const [storageOpen, setStorageOpen] = useState(initialSection === 'storage');
  return (
    <div role="presentation" className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] workspace:items-center"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={m.appearance.dialogLabel}
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
          <h2 className="text-base font-semibold">{m.settings.title}</h2>
          <button type="button" autoFocus className="min-h-11 rounded-md px-3 text-sm hover:bg-white/10" onClick={onClose}>{m.settings.done}</button>
        </div>
        <AppearanceSettings side={side} onSideChange={onSideChange} hand={hand} onHandChange={onHandChange} guidanceMode={guidanceMode} onGuidanceModeChange={onGuidanceModeChange} />
        <section className="mt-4 space-y-2 border-t border-white/15 pt-3" aria-label="Optional second opinion settings">
          <div className="flex items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-zinc-100">Optional second opinion</h3>
              <p className="text-xs text-zinc-400">{aiSettings ? 'Your selected provider is configured on this device. A second opinion is available when requested.' : 'Add your own provider for an optional second opinion. Kestrel\'s everyday colour checks work offline.'}</p></div>
            <button type="button" className="min-h-11 shrink-0 rounded-md border border-white/15 px-3 text-sm text-zinc-100" onClick={() => setAiSetupOpen((open) => !open)} aria-expanded={aiSetupOpen}>{aiSetupOpen ? 'Hide' : aiSettings ? 'Change' : 'Set up'}</button>
          </div>
          {aiSetupOpen && <AiProviderSetup saved={aiSettings} onDone={() => setAiSetupOpen(false)} />}
        </section>
        <section className="mt-4 border-t border-white/15 pt-3" aria-label="Your storage settings">
          <button type="button" aria-expanded={storageOpen}
            onClick={() => setStorageOpen((open) => !open)}
            className="flex min-h-11 w-full items-center justify-between rounded-md px-2 text-sm font-semibold text-zinc-100 hover:bg-white/10">
            Bring your own Storage <span aria-hidden="true">{storageOpen ? '−' : '+'}</span>
          </button>
          {storageOpen && <ConnectionsPanel />}
        </section>
        {onOpenMacroPad && isDesktopApp() && (
          <button type="button" data-phone-hidden onClick={() => { onClose(); onOpenMacroPad(); }}
            className="flex min-h-11 w-full items-center gap-2 rounded-md border border-white/15 px-3 text-sm text-zinc-200 hover:bg-white/10">
            <Keyboard className="h-4 w-4" aria-hidden="true" />{m.appearance.shortcuts}
          </button>
        )}
      </section>
    </div>
  );
}
