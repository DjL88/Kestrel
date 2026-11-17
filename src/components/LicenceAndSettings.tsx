import { useEffect, useRef, useState } from 'react';
import { buildSettingsFile, parseSettingsFile } from '../core/settingsTransfer';
import { SETTINGS_KEYS } from '../core/settingsTransfer';
import { downloadExport } from '../providers/browserExport';
import { removeLicence, saveLicence, useLicence } from '../providers/licenceStore';
import { BETA_ALL_FEATURES_OPEN } from '../providers/useAccess';
import { focusBeforeOpening, returnFocus } from './focusReturn';

const field = 'block min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm text-zinc-100';
const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300';

/** One calm place for the licence key and for copying settings to another device. */
export function LicenceAndSettings({ onClose }: { onClose: () => void }) {
  const licence = useLicence();
  const [key, setKey] = useState('');
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await saveLicence(key);
    if (result.ok) { setKey(''); setNote({ text: 'Thank you. Kestrel Pro is unlocked on this device.', good: true }); } else setNote({ text: result.message, good: false });
  }

  function exportSettings() {
    const file = buildSettingsFile((name) => { try { return localStorage.getItem(name); } catch { return null; } }, new Date());
    downloadExport(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), 'kestrel-settings.json');
    setSettingsNote(Object.keys(file.settings).length ? 'Saved. Put the file somewhere your other devices can reach, such as iCloud Drive.' : 'There are no changed settings to save yet.');
  }

  async function importSettings(file: File | undefined) {
    if (!file) return;
    const parsed = parseSettingsFile(await file.text());
    if (!parsed.ok) { setSettingsNote(parsed.reason); return; }
    try { for (const name of SETTINGS_KEYS) { if (name in parsed.settings) localStorage.setItem(name, parsed.settings[name]); } } catch { setSettingsNote('Could not keep the settings on this device. Check that storage is not full or blocked.'); return; }
    setSettingsNote('Settings copied. Kestrel will reload to use them.');
    window.setTimeout(() => window.location.reload(), 900);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="licence-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/12 bg-kestrel-panel shadow-2xl">
        <header className="shrink-0 border-b border-white/10 px-5 py-4">
          <h2 id="licence-title" ref={title} tabIndex={-1} className="text-base font-semibold text-zinc-100 focus:outline-none">Licence and settings</h2>
        </header>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
          <section aria-labelledby="licence-h" className="space-y-3">
            <h3 id="licence-h" className="font-medium text-zinc-100">Licence key</h3>
            {licence.status === 'valid'
              ? <p role="status">Kestrel Pro is unlocked on this device. It works offline and does not need an account.</p>
              : <p>{BETA_ALL_FEATURES_OPEN ? 'During the beta every feature is open. ' : 'Free is active. '}Bought Kestrel Pro? Paste the key from your receipt email.</p>}
            {licence.status === 'invalid' && <p role="alert" className="text-amber-200">{licence.message}</p>}
            {licence.status !== 'valid' ? (
              <form onSubmit={(event) => void submit(event)} className="space-y-2">
                <label className="block">Licence key
                  <input className={`${field} mt-1 font-mono`} value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="KESTREL1.…" />
                </label>
                <button type="submit" className={action} disabled={!key.trim()}>Unlock Kestrel Pro</button>
              </form>
            ) : (
              <button type="button" className={action} onClick={() => { removeLicence(); setNote(null); }}>Remove the key from this device</button>
            )}
            {note && <p role={note.good ? 'status' : 'alert'} className={note.good ? 'text-emerald-200' : 'text-amber-200'}>{note.text}</p>}
            <p className="text-xs text-zinc-400">No account, email or internet connection is needed. Lost your key? Re-send it from your receipt.</p>
          </section>
          <section aria-labelledby="settings-h" className="space-y-3">
            <h3 id="settings-h" className="font-medium text-zinc-100">Copy settings to another device</h3>
            <p>Your shortcuts, macro pad, display choices, export presets and watermark. Not your photos, edits, licence or any keys.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={action} onClick={exportSettings}>Save settings file</button>
              <button type="button" className={action} onClick={() => picker.current?.click()}>Load settings file</button>
              <input ref={picker} type="file" accept="application/json,.json" hidden data-testid="settings-file-input" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importSettings(file); }} />
            </div>
            {settingsNote && <p role="status">{settingsNote}</p>}
            <details className="text-xs text-zinc-400">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-zinc-300">Step by step, across Apple devices</summary>
              <ol className="list-decimal space-y-1 pl-5 pb-2">
                <li>On the first device choose <strong>Save settings file</strong> and save it in <strong>iCloud Drive</strong>.</li>
                <li>On the second device open Kestrel and this screen, choose <strong>Load settings file</strong>, then pick that file from iCloud Drive.</li>
                <li>Kestrel reloads with your settings. Do the same after changing settings on either device.</li>
              </ol>
              <p className="pb-2">Dropbox, OneDrive, Google Drive or a USB stick work the same way. Windows and Android can load the same file.</p>
            </details>
          </section>
        </div>
        <footer className="shrink-0 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} className={`${action} w-full`}>Close</button>
        </footer>
      </div>
    </div>
  );
}
