import { useEffect, useRef, useState } from 'react';
import { describePhoto, hasLocalVision, localVisionStatus, type LocalVisionResult } from '../providers/localVision';
import { sameVersion } from '../core/localVisionObservation';
import { localVisionLabels as t } from '../i18n/localVisionLabels';

interface Props {
  /** A 1,024-pixel JPEG of the edited photo, base64 (the same bounded preview the colour check uses). */
  readJpeg: () => string | null;
  /** Changes whenever the picture does, so an old answer is never shown as current. */
  version: readonly unknown[];
  disabled?: boolean;
}

/**
 * The on-device photo check (#703). Only on the desktop app, only when the model is installed, and only when the person asks:
 * nothing runs on its own, so Fly Solo makes no unsolicited call. It shows a plain observation and changes nothing.
 */
export function LocalPhotoCheck({ readJpeg, version, disabled }: Props) {
  const [installed, setInstalled] = useState(false);
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');
  const [result, setResult] = useState<LocalVisionResult | null>(null);
  const checkedVersion = useRef<readonly unknown[]>([]);
  const latest = useRef(version);
  latest.current = version;

  useEffect(() => {
    let active = true;
    if (hasLocalVision()) void localVisionStatus().then((status) => { if (active) setInstalled(Boolean(status?.installed)); });
    return () => { active = false; };
  }, []);

  if (!installed) return null;
  const stale = result !== null && !sameVersion(checkedVersion.current, version);

  async function check() {
    const jpeg = readJpeg();
    if (!jpeg) { setState('failed'); return; }
    checkedVersion.current = latest.current;
    const started = latest.current;
    setState('working');
    setResult(null);
    try {
      const bytes = Uint8Array.from(atob(jpeg), (char) => char.charCodeAt(0));
      const answer = await describePhoto(new Blob([bytes], { type: 'image/jpeg' }));
      // If the photo changed while the model was looking, the answer belongs to the old picture: keep it, but it shows as old.
      checkedVersion.current = started;
      setResult(answer);
      setState('idle');
    } catch { setState('failed'); }
  }

  return (
    <section aria-label={t.heading} className="border-t border-white/10 px-1 py-2 text-xs text-zinc-300">
      <button type="button" className="min-h-10 w-full text-left hover:text-white disabled:opacity-50" disabled={disabled || state === 'working'} onClick={() => void check()}>
        {state === 'working' ? t.checking : t.check}
      </button>
      <div aria-live="polite">
        {state === 'failed' && <p role="alert" className="mt-1 text-orange-200">{t.failed}</p>}
        {result?.usable && (
          <div className="mt-1 space-y-1">
            <p className={stale ? 'text-zinc-500' : 'text-zinc-100'}>{result.text}</p>
            {stale && <p className="text-zinc-400">{t.changed}</p>}
            <p className="text-zinc-500">{t.note} {t.timing(((result.timings.visionMs + result.timings.generateMs) / 1000).toFixed(1))}</p>
          </div>
        )}
      </div>
    </section>
  );
}
