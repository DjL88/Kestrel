import { AppearanceSettings } from './AppearanceSettings';
import { useBackToClose } from '../providers/useBackToClose';
import type { GuidanceMode } from '../core/guidanceMode';
import { ConnectionsPanel } from './ConnectionsPanel';
import { Keyboard } from 'lucide-react';
import { useState } from 'react';

type SettingsTab = 'display' | 'guidance' | 'connectivity';
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
  useBackToClose(onClose);
  const aiSettings = useAiSettings();
  const [aiSetupOpen, setAiSetupOpen] = useState(initialSection === 'ai');
  const [storageOpen, setStorageOpen] = useState(initialSection === 'storage');
  const [tab, setTab] = useState<SettingsTab>(initialSection === 'general' ? 'display' : 'connectivity');
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'display', label: 'Display' },
    ...(onGuidanceModeChange ? [{ id: 'guidance' as const, label: 'Photo guidance' }] : []),
    { id: 'connectivity', label: 'Connectivity' },
  ];
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
        className="flex max-h-[85dvh] w-full max-w-md min-w-0 flex-col overflow-hidden rounded-xl border border-white/15 bg-kestrel-panel shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4">
          <h2 className="text-base font-semibold">{m.settings.title}</h2>
        </div>
        <div role="tablist" aria-label="Settings sections" className="flex shrink-0 gap-1 border-b border-white/10 px-3 pt-2">
          {tabs.map(item => (
            <button key={item.id} type="button" role="tab" id={`appearance-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="appearance-panel"
              onClick={() => setTab(item.id)}
              className="min-h-11 rounded-t-md px-3 text-sm text-zinc-300 aria-selected:border-b-2 aria-selected:border-kestrel-copper aria-selected:text-zinc-50 hover:bg-white/8">{item.label}</button>
          ))}
        </div>
        <div id="appearance-panel" role="tabpanel" aria-labelledby={`appearance-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab !== 'connectivity' && <AppearanceSettings part={tab} side={side} onSideChange={onSideChange} hand={hand} onHandChange={onHandChange} guidanceMode={guidanceMode} onGuidanceModeChange={onGuidanceModeChange} />}
        {tab === 'connectivity' && <>
        <section className="space-y-2 border-white/15 pt-3" aria-label="Optional second opinion settings">
          <div className="flex items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-zinc-100">Optional second opinion</h3>
              <p className="text-xs text-zinc-400">{aiSettings ? 'Your selected provider is configured on this device. A second opinion is available when requested.' : 'Add your own provider for an optional second opinion. Kite44\'s everyday colour checks work offline.'}</p></div>
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
        </>}
        {tab === 'display' && onOpenMacroPad && isDesktopApp() && (
          <button type="button" data-phone-hidden onClick={() => { onClose(); onOpenMacroPad(); }}
            className="flex min-h-11 w-full items-center gap-2 rounded-md border border-white/15 px-3 text-sm text-zinc-200 hover:bg-white/10">
            <Keyboard className="h-4 w-4" aria-hidden="true" />{m.appearance.shortcuts}
          </button>
        )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-white/10 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button type="button" autoFocus className="min-h-11 rounded-md bg-kestrel-copper px-5 text-sm font-semibold text-zinc-950 hover:bg-kestrel-copper-hover!" onClick={onClose}>{m.settings.done}</button>
        </div>
      </section>
    </div>
  );
}
