import { useEffect, useRef, useState } from 'react';
import { returnFocus } from './focusReturn';
import { HELPER_CONSENT_VERSION, HELPER_SESSION_CAP } from '../core/onlineHelper';
import { checkKey, HelperError } from '../providers/onlineHelper';
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
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => returnFocus(previous);
  }, []);

  async function test(): Promise<string | null> {
    setStatus({ tone: 'busy', text: 'Checking the key…' });
    try {
      const { model } = await checkKey(key.trim());
      setStatus({ tone: 'ok', text: 'The key works.' });
      return model;
    } catch (error) {
      if ((error as Error).name === 'AbortError') return null;
      setStatus({ tone: 'bad', text: error instanceof HelperError && error.message ? error.message : 'The key could not be checked. Look at it and your connection.' });
      return null;
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
        if (event.key === 'Escape') { event.preventDefault(); openHelperDialog(false); }
        if (event.key === 'Tab') {
          const order = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
          if (!order.length) return;
          const at = order.indexOf(document.activeElement as HTMLElement);
          event.preventDefault();
          order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
        }
      }}>
      <div role="dialog" aria-modal="true" aria-labelledby="helper-title" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col rounded-xl border border-white/15 bg-kestrel-raised shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
        <h2 id="helper-title" className="shrink-0 px-5 pb-2 pt-5 text-lg font-semibold">Online helper (optional)</h2>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">
        <div className="space-y-2 text-sm text-zinc-300">
          <p>Optional. When the species model is not on this device and you are online, it can name the animal or bird in a photo and say whether it is wildlife, people or a landscape. It stays off until you turn it on here.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-zinc-100">Sent:</strong> a small copy of each photo (about 640 pixels), with no file name, camera data or location, to Google Gemini using your own key. Your original never leaves. People are never named.</li>
            <li>At most {HELPER_SESSION_CAP} photos in a session, one at a time.</li>
          </ul>
          <details className="rounded-md border border-white/10 px-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-zinc-100">What Google does with them</summary>
            <p className="pb-3">On Google’s free tier, submitted images may be used to improve its products and read by reviewers. On its paid tier they are not used that way. In the UK, EEA and Switzerland Google applies the paid-tier terms to free use too. Check Google’s current terms before relying on this.</p>
          </details>
        </div>
        <label className="flex items-start gap-2 text-sm text-zinc-100">
          <input ref={first} type="checkbox" className="mt-1" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          I understand that small copies of my photos are sent to Google when the helper is on.
        </label>
        <label className="block text-sm text-zinc-200">Your Gemini API key
          <input type="password" autoComplete="off" spellCheck={false} className={`${field} mt-1`} value={key} onChange={(event) => { setKey(event.target.value); setStatus(null); }} placeholder="Paste your key" />
        </label>
        <p className="text-xs text-zinc-400">The key stays on this device and is only ever sent to Google. Anyone who can use this browser profile can read it, so use a key made just for this and remove it from shared computers.</p>
        {status && <p role={status.tone === 'bad' ? 'alert' : 'status'} className={`text-sm ${status.tone === 'bad' ? 'text-orange-200' : status.tone === 'ok' ? 'text-emerald-200' : 'text-zinc-300'}`}>{status.text}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={() => { forgetHelper(); openHelperDialog(false); }} className="min-h-11 rounded-md px-3 text-sm text-zinc-300 underline underline-offset-4 hover:text-white">Remove key and turn off</button>
          <span className="flex gap-2">
            <button type="button" onClick={() => openHelperDialog(false)} className="min-h-11 rounded-md border border-white/20 px-4 text-sm font-semibold hover:bg-white/8">Close</button>
            <button type="button" disabled={!agreed || !key.trim() || status?.tone === 'busy'} onClick={() => void save()}
              className="min-h-11 rounded-md bg-kestrel-copper px-4 text-sm font-semibold text-zinc-950 hover:bg-kestrel-copper-hover! disabled:opacity-45">Check and turn on</button>
          </span>
        </div>
      </div>
    </div>
  );
}
