import React, { useEffect, useState } from 'react';
import BrandIcon from '../icons/BrandIcon';
import type { Photo, WorkspaceStore } from '../contract';
import { STRINGS } from '../strings';
import { autoBannerModel, LEFT_ALONE_MS } from './autoBannerModel';

interface AutoChangeBannerProps {
  photo: Photo | null | undefined;
  status: WorkspaceStore['autoStatus'];
  /** Before/After is showing. */
  comparing: boolean;
  /** Banners already dismissed ("photoId:time"), kept by the caller so a dismissal survives the banner unmounting (grid, collage, canvas only). */
  dismissed: ReadonlySet<string>;
  onDismiss: (key: string) => void;
  /** Only an Auto edit made at or after this time (ms) is announced: the start of this session. */
  since: number;
  onUndo: () => void;
  onToggleCompare: () => void;
}

/**
 * Laid over the top edge of the canvas (so it never moves or resizes the photo) after Auto (the button), Co-pilot or Auto-pilot changed this photo: what it changed, in words, and why,
 * with Undo and Before / After. It stays until it is dismissed, undone or the photo is edited further, so a change made
 * while the person was looking elsewhere is never a surprise (it is not shown again for an edit from an earlier session). When an automatic check left the photo alone, a one-line
 * "Looked good, left alone" shows briefly instead. Words, an icon and a text label carry every state, never colour alone.
 */
export default function AutoChangeBanner({ photo, status, comparing, dismissed, onDismiss, since, onUndo, onToggleCompare }: AutoChangeBannerProps) {
  const t = STRINGS.flight;
  const [now, setNow] = useState(() => Date.now());
  const model = autoBannerModel(photo, status, now, dismissed, since);
  const leftAloneUntil = model?.kind === 'left-alone' && status?.at ? status.at + LEFT_ALONE_MS : null;
  useEffect(() => {
    if (leftAloneUntil == null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, leftAloneUntil - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [leftAloneUntil]);
  // A status said before this banner mounted is read against the clock as it is now.
  useEffect(() => { setNow(Date.now()); }, [photo?.id, status?.at]);
  if (!photo || !model) return null;

  const small = 'inline-flex min-h-8 items-center rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]';
  if (model.kind === 'left-alone') {
    return (
      <div role="status" data-testid="auto-banner" data-kind="left-alone"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-sm">
        <BrandIcon name="check" size={14} />
        <span>{model.text}</span>
      </div>
    );
  }
  const who = model.who === 'copilot' ? STRINGS.topBar.assistModes.copilot : model.who === 'autopilot' ? STRINGS.topBar.assistModes.autopilot : STRINGS.autoEdit.label;
  const list = model.changes.length ? model.changes.join(', ') : t.smallChange;
  const [firstReason, ...moreReasons] = model.why;
  return (
    <section role="status" aria-label={t.bannerLabel} data-testid="auto-banner" data-kind="applied" data-who={model.who}
      className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-sm">
      <BrandIcon name="assist" size={16} className="mt-0.5 shrink-0 text-[var(--brand-accent)]" />
      <div className="min-w-0 flex-1 basis-60 space-y-1 leading-snug">
        <p data-testid="auto-banner-changed"><span className="font-semibold text-[var(--text-primary)]">{t.changed(who, list)}</span></p>
        {firstReason && <p data-testid="auto-banner-why">{t.why(firstReason)}</p>}
        {moreReasons.length > 0 && (
          <details className="text-[var(--text-secondary)]">
            <summary className="cursor-pointer text-[var(--text-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">{t.allReasons}</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{model.why.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          </details>
        )}
        {model.who === 'copilot' && <p data-testid="auto-banner-rest">{t.copilotRest}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button type="button" data-testid="auto-banner-undo" onClick={onUndo} className={small}>{STRINGS.autoEdit.undo}</button>
        <button type="button" data-testid="auto-banner-compare" aria-pressed={comparing} onClick={onToggleCompare} className={small}>{STRINGS.autoEdit.beforeAfter}</button>
        <button type="button" data-testid="auto-banner-dismiss" aria-label={t.dismiss} title={t.dismiss}
          onClick={() => onDismiss(`${photo.id}:${model.at}`)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
          <BrandIcon name="close" size={14} />
        </button>
      </div>
    </section>
  );
}
