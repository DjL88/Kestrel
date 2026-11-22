import { useEffect, useRef, useState } from 'react';
import { useBackToClose } from '../providers/useBackToClose';
import { buildSettingsFile, parseSettingsFile } from '../core/settingsTransfer';
import { SETTINGS_KEYS } from '../core/settingsTransfer';
import { downloadExport } from '../providers/browserExport';
import { focusBeforeOpening, returnFocus } from './focusReturn';
import { messages as m } from '../i18n/messages';
import { projectsText as t } from '../i18n/areas/projects';

import { AccountAndLicenceSettings } from './AccountAndLicenceSettings';

const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300';

/** One calm place for the licence key and for copying settings to another device. */
export function LicenceAndSettings({ onClose }: { onClose: () => void }) {
  useBackToClose(onClose);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const [tab, setTab] = useState<'account' | 'move' | 'about'>('account');
  const previous = useRef<HTMLElement | null>(focusBeforeOpening());
  const title = useRef<HTMLHeadingElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    title.current?.focus({ preventScroll: true });
    const keep = previous.current;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', close, true);
    return () => { document.removeEventListener('keydown', close, true); returnFocus(keep); };
  }, [onClose]);

  function exportSettings() {
    const file = buildSettingsFile((name) => { try { return localStorage.getItem(name); } catch { return null; } }, new Date());
    downloadExport(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), 'kestrel-settings.json');
    setSettingsNote(Object.keys(file.settings).length ? t.licence.settingsSaved : t.licence.noSettings);
  }

  async function importSettings(file: File | undefined) {
    if (!file) return;
    const parsed = parseSettingsFile(await file.text());
    if (!parsed.ok) { setSettingsNote(parsed.reason); return; }
    try { for (const name of SETTINGS_KEYS) { if (name in parsed.settings) localStorage.setItem(name, parsed.settings[name]); } } catch { setSettingsNote(t.licence.couldNotKeep); return; }
    setSettingsNote(t.licence.copied);
    window.setTimeout(() => window.location.reload(), 900);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="licence-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const order = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
        if (!order.length) return;
        const at = order.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
      }}>
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/12 bg-kestrel-panel shadow-2xl">
        <header className="shrink-0 border-b border-white/10 px-5 py-4">
          <h2 id="licence-title" ref={title} tabIndex={-1} className="text-base font-semibold text-zinc-100 focus:outline-none">{m.home.licence}</h2>
        </header>
        <div role="tablist" aria-label="Settings sections" className="flex shrink-0 gap-1 border-b border-white/10 px-3 pt-2"
          onKeyDown={(event) => {
            const order = ['account', 'move', 'about'] as const;
            const i = order.indexOf(tab);
            const next = event.key === 'ArrowRight' ? order[(i + 1) % 3] : event.key === 'ArrowLeft' ? order[(i + 2) % 3] : null;
            if (next) { event.preventDefault(); event.stopPropagation(); setTab(next); document.getElementById(`settings-tab-${next}`)?.focus(); }
          }}>
          {([['account', 'Account and Pro'], ['move', 'Move settings'], ['about', 'About']] as const).map(([id, label]) => (
            <button key={id} id={`settings-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="settings-panel" tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              className={`min-h-11 rounded-t-md border-b-2 px-3 text-sm focus-visible:outline-2 focus-visible:outline-sky-300 ${tab === id ? 'border-kestrel-copper text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}>{label}</button>
          ))}
        </div>
        <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
          {tab === 'account' && <AccountAndLicenceSettings />}

          {tab === 'move' && <>
          <section aria-labelledby="settings-h" className="space-y-3">
            <h3 id="settings-h" className="font-medium text-zinc-100">{t.licence.copyTitle}</h3>
            <p>{t.licence.copyBody}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={action} onClick={exportSettings}>{t.licence.saveFile}</button>
              <button type="button" className={action} onClick={() => picker.current?.click()}>{t.licence.loadFile}</button>
              <input ref={picker} type="file" accept="application/json,.json" hidden data-testid="settings-file-input" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importSettings(file); }} />
            </div>
            {settingsNote && <p role="status">{settingsNote}</p>}
            <details className="text-xs text-zinc-400">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-zinc-300">{t.licence.stepByStep}</summary>
              <ol className="list-decimal space-y-1 pl-5 pb-2">
                <li>{t.licence.step1Start}<strong>{t.licence.saveFile}</strong>{t.licence.step1Middle}<strong>iCloud Drive</strong>{t.licence.step1End}</li>
                <li>{t.licence.step2Start}<strong>{t.licence.loadFile}</strong>{t.licence.step2End}</li>
                <li>{t.licence.step3}</li>
              </ol>
              <p className="pb-2">{t.licence.otherWays}</p>
            </details>
          </section>
          </>}
          {tab === 'about' && <>
          <section aria-labelledby="build-information-h" className="space-y-2 border-t border-white/10 pt-4">
            <h3 id="build-information-h" className="font-medium text-zinc-100">{t.licence.buildTitle}</h3>
            <p className="text-xs text-zinc-400">{t.licence.buildHint}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt>{t.licence.sourceRevision}</dt>
              <dd className="select-text break-all font-mono">{import.meta.env.VITE_KESTREL_BUILD_REVISION || t.licence.unavailable}</dd>
              <dt>{t.licence.builtAt}</dt>
              <dd className="select-text break-all font-mono">{import.meta.env.VITE_KESTREL_BUILD_TIMESTAMP || t.licence.unavailable}</dd>
            </dl>
          </section>
          </>}
        </div>
        <footer className="shrink-0 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} className={`${action} w-full`}>{t.common.close}</button>
        </footer>
      </div>
    </div>
  );
}
