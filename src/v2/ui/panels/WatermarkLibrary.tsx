import React, { useState } from 'react';
import type { WatermarkPreset } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';

interface WatermarkLibraryProps {
  presets: WatermarkPreset[];
  selectedId: string;
  onSelect: (presetId: string) => void;
  onImport: () => Promise<string | null>;
  onCutOut: (presetId: string, slot: 'dark' | 'light', tolerance: number, commit: boolean) => Promise<{ url: string; tooMuch: boolean } | null>;
  onMakeVariant: (presetId: string, slot: 'dark' | 'light') => Promise<void>;
  onDelete: (presetId: string) => void;
}

const checker = 'repeating-conic-gradient(var(--bg-surface-active) 0% 25%, var(--bg-input) 0% 50%) 50% / 12px 12px';

/** A square showing artwork on the kind of photo it is for, so the person sees what each version looks like. */
function Swatch({ url, onDark, label }: { url?: string; onDark: boolean; label: string }) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      <span className="grid h-10 w-14 place-items-center overflow-hidden rounded-[var(--radius-xs)] border border-[var(--border-subtle)]" style={{ background: onDark ? '#14171F' : '#F4F1EA' }}>
        {url ? <img src={url} alt="" className="max-h-8 max-w-[3.25rem] object-contain" draggable={false} /> : <span className="text-[9px]" style={{ color: onDark ? '#B3B9C5' : '#4a4f5a' }}>{STRINGS.watermarks.none}</span>}
      </span>
      <span className="text-[10px] text-[var(--text-secondary)]">{label}</span>
    </span>
  );
}

/**
 * The watermark library: the person's own images, saved on this device, as many as they like. Each can hold a version for
 * dark photos (a light mark) and one for light photos (a dark mark); "auto" chooses by the photo. A flat background (a
 * logo saved as a JPEG with white round it) can be removed, with a preview over a checkerboard, and the original image is
 * left as it was imported.
 */
export default function WatermarkLibrary({ presets, selectedId, onSelect, onImport, onCutOut, onMakeVariant, onDelete }: WatermarkLibraryProps) {
  const [editing, setEditing] = useState<{ id: string; slot: 'dark' | 'light' } | null>(null);
  const [tolerance, setTolerance] = useState(25);
  const [preview, setPreview] = useState<{ url: string; tooMuch: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const preparePreview = async (id: string, slot: 'dark' | 'light', value: number) => {
    setBusy(true);
    setPreview(await onCutOut(id, slot, value, false));
    setBusy(false);
  };
  const startEditing = (preset: WatermarkPreset, slot: 'dark' | 'light') => {
    setEditing({ id: preset.id, slot });
    void preparePreview(preset.id, slot, tolerance);
  };

  return (
    <div className="space-y-2" data-testid="watermark-library">
      <div className="space-y-1.5">
        {presets.map((preset) => {
          const isImage = preset.kind === 'image';
          const selected = selectedId === preset.id;
          return (
            <div key={preset.id} className={`rounded-[var(--radius-sm)] border ${selected ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]' : 'border-[var(--border-subtle)] bg-[var(--bg-input)]'}`}>
              <button type="button" aria-pressed={selected} onClick={() => onSelect(preset.id)} className="flex w-full flex-col px-2.5 py-2 text-left">
                <span className="text-xs font-semibold text-[var(--text-primary)]">{preset.label}</span>
                {!isImage && <span className="mt-0.5 font-mono text-[10px] text-[var(--text-secondary)]">{preset.text} {preset.subtext ? `· ${preset.subtext}` : ''}</span>}
              </button>
              {isImage && (
                <div className="space-y-2 px-2.5 pb-2.5">
                  <div className="flex items-end gap-3">
                    <Swatch url={preset.forDarkUrl} onDark label={STRINGS.watermarks.forDark} />
                    <Swatch url={preset.forLightUrl} onDark={false} label={STRINGS.watermarks.forLight} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {([['dark', STRINGS.watermarks.removeBgDark, preset.forDarkUrl], ['light', STRINGS.watermarks.removeBgLight, preset.forLightUrl]] as const).map(([slot, label, url]) => url && (
                      <button key={slot} type="button" onClick={() => startEditing(preset, slot)}
                        className="rounded-[var(--radius-xs)] border border-[var(--border-default)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">{label}</button>
                    ))}
                    {!preset.forDarkUrl && <button type="button" onClick={() => void onMakeVariant(preset.id, 'dark')} className="rounded-[var(--radius-xs)] border border-[var(--border-default)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">{STRINGS.watermarks.makeLight}</button>}
                    {!preset.forLightUrl && <button type="button" onClick={() => void onMakeVariant(preset.id, 'light')} className="rounded-[var(--radius-xs)] border border-[var(--border-default)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">{STRINGS.watermarks.makeDark}</button>}
                    <button type="button" onClick={() => onDelete(preset.id)} className="rounded-[var(--radius-xs)] px-2 py-1 text-[11px] font-medium text-[var(--semantic-danger)] hover:bg-[var(--bg-surface-hover)]">{STRINGS.watermarks.delete}</button>
                  </div>
                  {editing?.id === preset.id && (
                    <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2" data-testid="cutout-editor">
                      <p className="text-[11px] text-[var(--text-secondary)]">{STRINGS.watermarks.removeBgHelp}</p>
                      <div className="grid h-24 place-items-center overflow-hidden rounded-[var(--radius-xs)]" style={{ background: checker }}>
                        {preview ? <img src={preview.url} alt={STRINGS.watermarks.previewAlt} className="max-h-20 max-w-full object-contain" draggable={false} data-testid="cutout-preview" /> : <span role="status" className="text-xs text-[var(--text-secondary)]">{STRINGS.watermarks.working}</span>}
                      </div>
                      <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                        <span className="shrink-0">{STRINGS.watermarks.tolerance}</span>
                        <input type="range" min={0} max={100} value={tolerance} aria-label={STRINGS.watermarks.tolerance} className="inflight-slider"
                          onChange={(event) => { const value = Number(event.target.value); setTolerance(value); void preparePreview(preset.id, editing.slot, value); }} />
                        <span className="w-8 text-right font-mono tabular-nums">{tolerance}</span>
                      </label>
                      {preview?.tooMuch && <p role="status" className="text-[11px] text-[var(--text-primary)]">{STRINGS.watermarks.tooMuch}</p>}
                      <div className="flex gap-1.5">
                        <button type="button" disabled={busy || !preview || preview.tooMuch} data-testid="cutout-apply"
                          onClick={async () => { await onCutOut(preset.id, editing.slot, tolerance, true); setEditing(null); setPreview(null); }}
                          className="rounded-[var(--radius-xs)] bg-[var(--brand-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-on-accent)] disabled:opacity-50">{STRINGS.watermarks.apply}</button>
                        <button type="button" onClick={() => { setEditing(null); setPreview(null); }} className="rounded-[var(--radius-xs)] border border-[var(--border-default)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)]">{STRINGS.watermarks.cancel}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={async () => { const id = await onImport(); if (id) onSelect(id); }}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
        <BrandIcon name="plus" size={13} />{STRINGS.watermarks.add}
      </button>
      <p className="text-[11px] leading-snug text-[var(--text-secondary)]">{STRINGS.watermarks.localNote}</p>
    </div>
  );
}
