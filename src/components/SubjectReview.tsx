import { useEffect, useRef, useState } from 'react';
import { libraryText } from '../i18n/areas/library';
import type { SubjectReviewItem } from '../providers/subjectReview';
import type { SubjectGenre } from '../core/subjectDetailBurst';
import { LoaderCircle } from './icons/KestrelUIIcons';

const t = libraryText.subjectReview;
const genreLabels: Partial<Record<SubjectGenre, string>> = {
  bird: t.bird, aircraft: t.aircraft, person: t.person, pet: t.pet,
};

function SubjectCrop({ crop, label }: { crop: HTMLCanvasElement; label: string }) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = target.current;
    if (!node) return;
    crop.style.maxWidth = 'none';
    crop.setAttribute('role', 'img');
    crop.setAttribute('aria-label', label);
    node.append(crop);
    return () => { crop.remove(); };
  }, [crop, label]);
  return (
    <div ref={target} role="region" aria-label={label} tabIndex={0}
      className="mt-1 max-h-52 overflow-auto rounded bg-black focus-visible:outline-2 focus-visible:outline-sky-300" />
  );
}

type Scan = (signal: AbortSignal) => Promise<SubjectReviewItem[] | null>;
type Result = { status: 'idle' | 'busy' | 'unavailable' } | { status: 'done'; items: SubjectReviewItem[] };

export function SubjectReview({ scan }: { scan: Scan }) {
  const active = useRef<AbortController | null>(null);
  const [result, setResult] = useState<Result>({ status: 'idle' });
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);

  async function run() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setSelected(null);
    setResult({ status: 'busy' });
    try {
      const items = await scan(controller.signal);
      if (!controller.signal.aborted) setResult(items ? { status: 'done', items } : { status: 'unavailable' });
    } catch {
      if (!controller.signal.aborted) setResult({ status: 'unavailable' });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  const busy = result.status === 'busy';
  return (
    <section aria-label={t.find} className="my-3 space-y-2 border-t border-white/10 pt-2">
      <button type="button" disabled={busy} onClick={() => void run()}
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-white/10 px-3 text-sm text-zinc-100 enabled:hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-sky-300">
        {busy && <LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />}
        {t.find}
      </button>
      <p role="status" className="text-xs text-zinc-300">
        {busy ? t.busy : result.status === 'unavailable' ? t.unavailable : result.status === 'done'
          ? (result.items.length ? t.found : t.empty) : ''}
      </p>
      {result.status === 'done' && result.items.length > 0 && (
        <ol className="space-y-1">
          {result.items.map(({ genre, crop }, index) => {
            const name = t.label(index + 1, genreLabels[genre] ?? t.unknown);
            return (
              <li key={index}>
                {crop ? (
                  <>
                    <button type="button" aria-expanded={selected === index}
                      onClick={() => setSelected(selected === index ? null : index)}
                      className="min-h-11 w-full rounded-md bg-white/5 px-2 text-left text-sm text-zinc-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
                      {name}
                    </button>
                    {selected === index && <SubjectCrop crop={crop} label={name} />}
                  </>
                ) : <p className="px-2 py-2 text-sm text-zinc-300">{name} · {t.cropUnavailable}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
