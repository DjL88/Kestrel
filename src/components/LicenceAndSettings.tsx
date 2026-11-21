import { useEffect, useRef, useState } from 'react';
import { buildSettingsFile, parseSettingsFile } from '../core/settingsTransfer';
import { SETTINGS_KEYS } from '../core/settingsTransfer';
import { downloadExport } from '../providers/browserExport';
import type { Session, SignInProvider } from '../core/cloudInterfaces';
import { signInOptions } from '../core/signInOptions';
import { firebaseAuth, isSignInConfigured, signInPlatform } from '../providers/firebaseAuth';
import { removeLicence, saveLicence, useLicence } from '../providers/licenceStore';
import { isDesktopApp, isMobileShell } from '../providers/desktopShell';
import { DEV_PRO_PREVIEW_MODE } from '../providers/useAccess';
import { focusBeforeOpening, returnFocus } from './focusReturn';
import { LicenceOnlineStatus } from './LicenceOnlineStatus';
import { messages as m } from '../i18n/messages';
import { projectsText as t } from '../i18n/areas/projects';

const field = 'block min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm text-zinc-100';
const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300';

/** One calm place for the licence key and for copying settings to another device. */
export function LicenceAndSettings({ onClose }: { onClose: () => void }) {
  const licence = useLicence();
  const [key, setKey] = useState('');
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const [account, setAccount] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountNote, setAccountNote] = useState<string | null>(null);
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

  useEffect(() => { void firebaseAuth.current().then(setAccount, () => setAccount(null)); }, []);

  async function chooseSignIn(provider: SignInProvider) {
    setAccountNote(null);
    try { setAccount(await firebaseAuth.signIn(provider)); } catch (error) { setAccountNote(error instanceof Error ? error.message : 'Sign-in did not complete.'); }
  }

  async function emailAction(kind: 'in' | 'create' | 'reset') {
    setAccountNote(null);
    try {
      if (kind === 'reset') { await firebaseAuth.sendPasswordReset(email); setAccountNote('If that email has an account, a reset link is on its way.'); return; }
      setAccount(await (kind === 'in' ? firebaseAuth.signInWithEmail(email, password) : firebaseAuth.createAccount(email, password)));
      setPassword('');
      if (kind === 'create') setAccountNote('Account created. Check your email to verify the address.');
    } catch (error) { setAccountNote(error instanceof Error ? error.message : 'Sign-in did not complete.'); }
  }

  async function chooseSignOut() {
    try { await firebaseAuth.signOut(); } finally { setAccount(null); setAccountNote('Signed out. Your photos and edits on this device are unchanged.'); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await saveLicence(key);
    if (result.ok) { setKey(''); setNote({ text: t.licence.thanks, good: true }); } else setNote({ text: result.message, good: false });
  }

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
    <div role="dialog" aria-modal="true" aria-labelledby="licence-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
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
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
          <section aria-labelledby="licence-h" className="space-y-3">
            <h3 id="licence-h" className="font-medium text-zinc-100">{t.licence.licenceKey}</h3>
            {licence.status === 'valid'
              ? <>{licence.access.pro && <p role="status">{t.licence.unlocked}</p>}<LicenceOnlineStatus licence={licence} /></>
              : <p>{t.licence.notUnlocked(DEV_PRO_PREVIEW_MODE)}</p>}
            {licence.status === 'invalid' && <p role="alert" className="text-amber-200">{licence.message}</p>}
            {licence.status !== 'valid' ? (
              <form onSubmit={(event) => void submit(event)} className="space-y-2">
                <label className="block">{t.licence.licenceKey}
                  <input className={`${field} mt-1 font-mono`} value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="KESTREL1.…" />
                </label>
                <button type="submit" className={action} disabled={!key.trim()}>{t.licence.unlock}</button>
              </form>
            ) : (
              <button type="button" className={action} onClick={() => { setNote(null); void removeLicence(); }}>{t.licence.removeKey}</button>
            )}
            {licence.status !== 'valid' && !isMobileShell() && (
              <a href="https://kestrel-hosting-kestrel.web.app/#pricing" target="_blank" rel="noopener noreferrer"
                className={`${action} inline-flex items-center`}
                onClick={(event) => {
                  if (!isDesktopApp()) return;
                  event.preventDefault();
                  const url = event.currentTarget.href;
                  void import('@tauri-apps/plugin-opener')
                    .then(({ openUrl }) => openUrl(url))
                    .catch(() => setNote({ text: t.licence.pricingUnavailable, good: false }));
                }}>{t.licence.viewProPricing}</a>
            )}
            {note && <p role={note.good ? 'status' : 'alert'} className={note.good ? 'text-emerald-200' : 'text-amber-200'}>{note.text}</p>}
            <p className="text-xs text-zinc-400">{t.licence.noAccount}</p>
          </section>
          <section aria-labelledby="account-h" className="space-y-3">
            <h3 id="account-h" className="font-medium text-zinc-100">Account (optional)</h3>
            {account ? (
              <>
                <p role="status">Signed in with {account.provider === 'apple' ? 'Apple' : account.provider === 'password' ? 'email' : 'Google'}{account.email ? ` as ${account.email}` : ''}.</p>
                <button type="button" className={action} onClick={() => void chooseSignOut()}>Sign out</button>
              </>
            ) : (
              <>
                <p>Signing in is only for cloud features that are not available yet. Importing, culling, editing and exporting never need an account.</p>
                <div className="flex flex-wrap gap-2">
                  {signInOptions(signInPlatform(), isSignInConfigured()).map((option) => (
                    <button key={option.provider} type="button" className={`${action} disabled:opacity-60`} disabled={!option.available} aria-describedby={option.reason ? 'account-reason' : undefined} onClick={() => void chooseSignIn(option.provider)}>{option.label}</button>
                  ))}
                </div>
                {isSignInConfigured() && (
                  <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void emailAction('in'); }}>
                    <label className="block">Email
                      <input className={`${field} mt-1`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
                    </label>
                    <label className="block">Password
                      <input className={`${field} mt-1`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className={action} disabled={!email.trim() || !password}>Sign in</button>
                      <button type="button" className={action} disabled={!email.trim() || !password} onClick={() => void emailAction('create')}>Create account</button>
                      <button type="button" className={action} disabled={!email.trim()} onClick={() => void emailAction('reset')}>Reset password</button>
                    </div>
                  </form>
                )}
                {signInOptions(signInPlatform(), isSignInConfigured())[0]?.reason && <p id="account-reason" className="text-xs text-zinc-400">{signInOptions(signInPlatform(), isSignInConfigured())[0]?.reason}</p>}
              </>
            )}
            {accountNote && <p role="status" className="text-amber-200">{accountNote}</p>}
          </section>
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
        </div>
        <footer className="shrink-0 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} className={`${action} w-full`}>{t.common.close}</button>
        </footer>
      </div>
    </div>
  );
}
