import { useEffect, useRef, useState } from 'react';
import { returnFocus } from './focusReturn';
import { HELPER_CONSENT_VERSION, HELPER_SESSION_CAP } from '../core/onlineHelper';
import { checkKey, HelperError } from '../providers/onlineHelper';
import { projectsText as t } from '../i18n/areas/projects';
import { forgetHelper, openHelperDialog, saveHelper, useHelperDialog, useHelperSettings } from '../providers/helperSettings';

/**
 * Where the optional online helper is switched on. It says plainly where photos go, asks for agreement, and takes the
 * user's own key. Nothing is sent until all of that is done.
 */
export function OnlineHelperDialog() {
  const open = useHelperDialog();
  return open ? <Panel /> : null;
}

function Panel() {
  const saved = useHelperSettings();
  const [key, setKey] = useState(saved.key);
  const [agreed, setAgreed] = useState(saved.consent === HELPER_CONSENT_VERSION);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad' | 'busy'; text: string } | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const checking = useRef<AbortController | null>(null);
  const cancelCheck = () => { checking.current?.abort(); checking.current = null; };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => { cancelCheck(); returnFocus(previous); };
  }, []);

  async function test(): Promise<string | null> {
    cancelCheck();
    const controller = new AbortController();
    checking.current = controller;
    setStatus({ tone: 'busy', text: t.helper.checking });
    try {
      const { model } = await checkKey(key.trim(), fetch, controller.signal);
      if (checking.current !== controller || controller.signal.aborted) return null;
      setStatus({ tone: 'ok', text: t.helper.works });
      return model;
    } catch (error) {
      if (checking.current !== controller || controller.signal.aborted || (error as Error).name === 'AbortError') return null;
      setStatus({ tone: 'bad', text: error instanceof HelperError && error.message ? error.message : t.helper.couldNotCheck });
      return null;
    } finally {
      if (checking.current === controller) checking.current = null;
    }
  }

  async function save() {
    const model = await test();
    if (!model) return;
    saveHelper({ enabled: true, consent: HELPER_CONSENT_VERSION, key: key.trim(), model });
    openHelperDialog(false);
  }

  const field = 'min-h-11 w-full rounded-md border border-white/15 bg-black/20 px-3 text-base sm:text-sm';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 sm:p-4"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); cancelCheck(); openHelperDialog(false); }
        if (event.key === 'Tab') {
          const order = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
          if (!order.length) return;
          const at = order.indexOf(document.activeElement as HTMLElement);
          event.preventDefault();
          order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
        }
      }}>
      <div role="dialog" aria-modal="true" aria-labelledby="helper-title" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col rounded-xl border border-white/15 bg-kestrel-raised shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
        <h2 id="helper-title" className="shrink-0 px-5 pb-2 pt-5 text-lg font-semibold">{t.helper.title}</h2>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">
        <div className="space-y-2 text-sm text-zinc-300">
          <p>{t.helper.intro}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-zinc-100">{t.helper.sentLead}</strong> {t.helper.sent}</li>
            <li>{t.helper.atMost(HELPER_SESSION_CAP)}</li>
          </ul>
          <details className="rounded-md border border-white/10 px-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-zinc-100">{t.helper.whatGoogleDoes}</summary>
            <p className="pb-3">{t.helper.googleTerms}</p>
          </details>
        </div>
        <label className="flex items-start gap-2 text-sm text-zinc-100">
          <input ref={first} type="checkbox" className="mt-1" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          {t.helper.agree}
        </label>
        <label className="block text-sm text-zinc-200">{t.helper.keyLabel}
          <input type="password" autoComplete="off" spellCheck={false} className={`${field} mt-1`} value={key} onChange={(event) => { cancelCheck(); setKey(event.target.value); setStatus(null); }} placeholder={t.helper.keyPlaceholder} />
        </label>
        <p className="text-xs text-zinc-400">{t.helper.keyNote}</p>
        {status && <p role={status.tone === 'bad' ? 'alert' : 'status'} className={`text-sm ${status.tone === 'bad' ? 'text-orange-200' : status.tone === 'ok' ? 'text-emerald-200' : 'text-zinc-300'}`}>{status.text}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={() => { cancelCheck(); forgetHelper(); openHelperDialog(false); }} className="min-h-11 rounded-md px-3 text-sm text-zinc-300 underline underline-offset-4 hover:text-white">{t.helper.remove}</button>
          <span className="flex gap-2">
            <button type="button" onClick={() => { cancelCheck(); openHelperDialog(false); }} className="min-h-11 rounded-md border border-white/20 px-4 text-sm font-semibold hover:bg-white/8">{t.common.close}</button>
            <button type="button" disabled={!agreed || !key.trim() || status?.tone === 'busy'} onClick={() => void save()}
              className="min-h-11 rounded-md bg-kestrel-copper px-4 text-sm font-semibold text-zinc-950 hover:bg-kestrel-copper-hover! disabled:opacity-45">{t.helper.turnOn}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
