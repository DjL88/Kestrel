import React, { useState } from 'react';
import type { WatermarkUsage } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';

type Slot = 'dark' | 'light';

interface WatermarkSetupProps {
  onImport: (usage: WatermarkUsage) => Promise<string | null>;
  onAddText: (text: string, subtext: string) => string | null;
  onAddVersion: (presetId: string, slot: Slot) => Promise<boolean>;
  onMakeVariant: (presetId: string, slot: Slot) => Promise<void>;
  onCutOut: (presetId: string, slot: Slot, tolerance: number, commit: boolean) => Promise<{ url: string; tooMuch: boolean } | null>;
  /** Called when a watermark is made, so this photo shows it straight away. */
  onCreated: (presetId: string) => void;
  onClose: () => void;
}

type Step =
  | { name: 'kind' }
  | { name: 'use' }
  | { name: 'text' }
  | { name: 'other'; id: string; missing: Slot }
  | { name: 'background'; id: string; slots: Slot[]; next: Step }
  | { name: 'done' };

const checker = 'repeating-conic-gradient(var(--bg-surface-active) 0% 25%, var(--bg-input) 0% 50%) 50% / 12px 12px';

const choiceClass = 'flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-left text-xs font-medium text-[var(--text-primary)] hover:border-[var(--brand-accent)]';
const quietClass = 'min-h-9 rounded-[var(--radius-sm)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]';
const primaryClass = 'min-h-9 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-3 text-xs font-semibold text-[var(--text-on-accent)] disabled:opacity-50';

/**
 * Adding a watermark, one question at a time: a logo image or text; for an image, which photos it is for (it is light, so
 * dark photos; it is dark, so light photos; or it shows on both); then the other version (the person's own, made for them,
 * or not now); then whether a plain background should go. A text watermark needs no versions: it is drawn light or dark.
 */
export default function WatermarkSetup({ onImport, onAddText, onAddVersion, onMakeVariant, onCutOut, onCreated, onClose }: WatermarkSetupProps) {
  const [step, setStep] = useState<Step>({ name: 'kind' });
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [subtext, setSubtext] = useState('');
  const [tolerance, setTolerance] = useState(25);
  const [preview, setPreview] = useState<{ url: string; tooMuch: boolean } | null>(null);

  const run = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try { return await work(); } finally { setBusy(false); }
  };

  // The background goes first, so a version made from this artwork is made from the clean shape, not a filled box.
  // Then, unless it shows on both, the version the other kind of photo needs.
  const afterImport = (id: string, usage: Exclude<WatermarkUsage, 'auto'>) => {
    onCreated(id);
    const slots: Slot[] = usage === 'both' ? ['dark', 'light'] : [usage];
    const next: Step = usage === 'both' ? { name: 'done' } : { name: 'other', id, missing: usage === 'dark' ? 'light' : 'dark' };
    setStep({ name: 'background', id, slots, next });
    setPreview(null);
    void onCutOut(id, slots[0], tolerance, false).then(setPreview);
  };

  const heading = (words: string) => <p className="text-xs font-semibold text-[var(--text-primary)]">{words}</p>;

  return (
    <section aria-label={STRINGS.overlayKit.wmAdd} data-testid="watermark-setup" className="space-y-3 rounded-[var(--radius-md)] border border-[var(--brand-accent-border)] bg-[var(--bg-input)] p-3">
      {step.name === 'kind' && (
        <>
          {heading(STRINGS.overlayKit.wmStepKind)}
          <button type="button" className={choiceClass} onClick={() => setStep({ name: 'use' })}><BrandIcon name="watermark-library" size={14} />{STRINGS.overlayKit.wmKindImage}</button>
          <button type="button" className={choiceClass} onClick={() => setStep({ name: 'text' })}><BrandIcon name="text" size={14} />{STRINGS.overlayKit.wmKindText}</button>
          <div className="flex justify-end"><button type="button" className={quietClass} onClick={onClose}>{STRINGS.overlayKit.wmCancel}</button></div>
        </>
      )}

      {step.name === 'use' && (
        <>
          {heading(STRINGS.overlayKit.wmStepUse)}
          {([
            ['dark', STRINGS.overlayKit.wmUseDark, 'swatch-light-on-dark'],
            ['light', STRINGS.overlayKit.wmUseLight, 'swatch-dark-on-light'],
            ['both', STRINGS.overlayKit.wmUseBoth, 'watermark'],
          ] as const).map(([usage, label, icon]) => (
            <button key={usage} type="button" disabled={busy} className={choiceClass}
              onClick={async () => { const id = await run(() => onImport(usage)); if (id) afterImport(id, usage); }}>
              <BrandIcon name={icon} size={14} />{label}
            </button>
          ))}
          <p className="text-[0.6875rem] text-[var(--text-muted)]">{STRINGS.overlayKit.wmChooseFile}</p>
          <div className="flex justify-between"><button type="button" className={quietClass} onClick={() => setStep({ name: 'kind' })}>{STRINGS.overlayKit.wmBack}</button><button type="button" className={quietClass} onClick={onClose}>{STRINGS.overlayKit.wmCancel}</button></div>
        </>
      )}

      {step.name === 'text' && (
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const id = onAddText(text, subtext); if (id) { onCreated(id); setStep({ name: 'done' }); } }}>
          <label className="block space-y-1 text-[0.6875rem] text-[var(--text-secondary)]">
            <span>{STRINGS.overlayKit.wmTextLine}</span>
            <input type="text" value={text} maxLength={60} onChange={(e) => setText(e.target.value)} placeholder="© …"
              className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]" />
          </label>
          <label className="block space-y-1 text-[0.6875rem] text-[var(--text-secondary)]">
            <span>{STRINGS.overlayKit.wmTextSecond}</span>
            <input type="text" value={subtext} maxLength={60} onChange={(e) => setSubtext(e.target.value)}
              className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]" />
          </label>
          <div className="flex justify-between gap-2">
            <button type="button" className={quietClass} onClick={() => setStep({ name: 'kind' })}>{STRINGS.overlayKit.wmBack}</button>
            <button type="submit" className={primaryClass} disabled={!text.trim()}>{STRINGS.overlayKit.wmTextAdd}</button>
          </div>
        </form>
      )}

      {step.name === 'other' && (
        <>
          {heading(STRINGS.overlayKit.wmStepOther)}
          <p className="text-[0.6875rem] text-[var(--text-muted)]">{step.missing === 'light' ? STRINGS.overlayKit.wmUseLight : STRINGS.overlayKit.wmUseDark}</p>
          <button type="button" disabled={busy} className={choiceClass} onClick={async () => { if (await run(() => onAddVersion(step.id, step.missing))) setStep({ name: 'done' }); }}>{STRINGS.overlayKit.wmOtherHave}</button>
          <button type="button" disabled={busy} className={choiceClass} onClick={async () => { await run(() => onMakeVariant(step.id, step.missing)); setStep({ name: 'done' }); }}>{STRINGS.overlayKit.wmOtherMake}</button>
          <button type="button" disabled={busy} className={choiceClass} onClick={() => setStep({ name: 'done' })}>{STRINGS.overlayKit.wmOtherSkip}</button>
        </>
      )}

      {step.name === 'background' && (
        <>
          {heading(STRINGS.overlayKit.wmStepBackground)}
          <p className="text-[0.6875rem] text-[var(--text-secondary)]">{STRINGS.watermarks.removeBgHelp}</p>
          <div className="grid h-24 place-items-center overflow-hidden rounded-[var(--radius-xs)]" style={{ background: checker }}>
            {preview ? <img src={preview.url} alt={STRINGS.watermarks.previewAlt} className="max-h-20 max-w-full object-contain" draggable={false} data-testid="setup-cutout-preview" /> : <span role="status" className="text-xs text-[var(--text-secondary)]">{STRINGS.watermarks.working}</span>}
          </div>
          <label className="flex items-center gap-2 text-[0.6875rem] text-[var(--text-secondary)]">
            <span className="shrink-0">{STRINGS.watermarks.tolerance}</span>
            <input type="range" min={0} max={100} value={tolerance} aria-label={STRINGS.watermarks.tolerance} className="inflight-slider"
              onChange={(event) => { const value = Number(event.target.value); setTolerance(value); void onCutOut(step.id, step.slots[0], value, false).then(setPreview); }} />
          </label>
          {preview?.tooMuch && <p role="status" className="text-[0.6875rem] text-[var(--text-primary)]">{STRINGS.watermarks.tooMuch}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={quietClass} onClick={() => setStep(step.next)}>{STRINGS.overlayKit.wmKeepBackground}</button>
            <button type="button" data-testid="setup-cutout-apply" className={primaryClass} disabled={busy || !preview || preview.tooMuch}
              onClick={async () => { await run(async () => { for (const slot of step.slots) await onCutOut(step.id, slot, tolerance, true); }); setStep(step.next); }}>{STRINGS.watermarks.apply}</button>
          </div>
        </>
      )}

      {step.name === 'done' && (
        <>
          <p role="status" className="text-xs text-[var(--text-primary)]">{STRINGS.overlayKit.wmDone}</p>
          <div className="flex justify-end"><button type="button" className={primaryClass} onClick={onClose}>{STRINGS.overlayKit.wmFinish}</button></div>
        </>
      )}
    </section>
  );
}
