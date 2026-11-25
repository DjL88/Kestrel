import React from 'react';
import type { FontOption, OverlayFieldId, OverlaySettings, OverlayTextRow, Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import FontPicker from './FontPicker';
import { MAX_OVERLAY_ROWS, isOverlayField, moveInList, overlayFieldChoices, overlayFieldGroup, overlayFieldText, type OverlayFieldGroup } from '../utils/overlayMetadata';
import { capRowSize, formatOverlayRowText, maxRowSizePx } from '../utils/studioMath';

const GROUP_ORDER: OverlayFieldGroup[] = ['camera', 'file', 'subject', 'text'];

const fieldLabel = (field: OverlayFieldId) => STRINGS.overlayKit.fields[field] ?? field;

interface OverlayTextRowsProps {
  rows: OverlayTextRow[];
  /** Where the words come from: the photo's file fields and what subject detection found. */
  photo: Photo;
  /** For the size cap: the layout mode and edge margin decide how much width a row may use. */
  overlay: Pick<OverlaySettings, 'textLayoutMode' | 'edgeMargin'>;
  fonts: FontOption[];
  onAddRow: () => void;
  onUpdateRow: (rowId: string, patch: Partial<OverlayTextRow>) => void;
  onRemoveRow: (rowId: string) => void;
  onMoveRow: (rowId: string, direction: -1 | 1) => void;
  onAddCustomFont: (fontName: string) => void;
  onListDeviceFonts: () => Promise<string[] | null>;
  onHasDeviceFont: (fontName: string) => boolean;
}

/**
 * The text rows of an overlay: any number of rows (up to MAX_OVERLAY_ROWS), each built by choosing fields one after another
 * ("Choose a field", then "+ Choose next"), from the photo's file, its camera details and subject detection, or the person's
 * own words. Self-contained, so anything else that captions a photo (a collage page) can use the same editor.
 */
export default function OverlayTextRows({ rows, photo, overlay, fonts, onAddRow, onUpdateRow, onRemoveRow, onMoveRow, onAddCustomFont, onListDeviceFonts, onHasDeviceFont }: OverlayTextRowsProps) {
  /** Every change goes through the size cap, so more fields or capitals can never push a row past the frame. */
  const change = (row: OverlayTextRow, patch: Partial<OverlayTextRow>) => {
    const next = capRowSize({ ...row, ...patch }, photo, overlay);
    onUpdateRow(row.id, next.sizePx !== (patch.sizePx ?? row.sizePx) ? { ...patch, sizePx: next.sizePx } : patch);
  };

  return (
    <div className="space-y-2.5" data-testid="overlay-text-rows">
      <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.overlays.rowsHeading}</h3>
      {rows.map((row, index) => {
        const n = index + 1;
        const choices = overlayFieldChoices(photo, row.fields);
        const grouped = GROUP_ORDER.map((group) => ({ group, items: choices.filter(([id]) => overlayFieldGroup(id) === group) })).filter((entry) => entry.items.length > 0);
        const most = maxRowSizePx(row, photo, overlay);
        const words = formatOverlayRowText(row, photo);
        return (
          <div key={row.id} data-testid="overlay-row" className="space-y-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-2.5">
            <div className="flex items-center gap-1">
              <span className="flex-1 text-[0.6875rem] font-semibold text-[var(--text-secondary)]">{STRINGS.overlayKit.rowLabel(n)}</span>
              <button type="button" aria-label={STRINGS.overlayKit.moveRowUp(n)} disabled={index === 0} onClick={() => onMoveRow(row.id, -1)}
                className="grid h-7 w-7 place-items-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
                <BrandIcon name="chevron-up" size={13} />
              </button>
              <button type="button" aria-label={STRINGS.overlayKit.moveRowDown(n)} disabled={index === rows.length - 1} onClick={() => onMoveRow(row.id, 1)}
                className="grid h-7 w-7 place-items-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
                <BrandIcon name="chevron-down" size={13} />
              </button>
              {rows.length > 1 && (
                <button type="button" aria-label={STRINGS.panelWords.removeRow(n)} onClick={() => onRemoveRow(row.id)}
                  className="grid h-7 w-7 place-items-center rounded text-[var(--text-muted)] hover:text-[var(--semantic-danger)]">
                  <BrandIcon name="trash" size={13} />
                </button>
              )}
            </div>

            {/* The chosen fields, in order. Each shows what it says on this photo; one the photo lacks says so and is left out. */}
            {row.fields.length > 0 && (
              <ol className="flex flex-wrap gap-1" aria-label={STRINGS.overlayKit.rowLabel(n)}>
                {row.fields.map((field, at) => {
                  const label = fieldLabel(field);
                  const value = field === 'custom' ? row.customText.trim() : overlayFieldText(field, photo, row.customText);
                  return (
                    <li key={field} className={`inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[0.625rem] ${value ? 'border-[var(--brand-accent-border)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]' : 'border-dashed border-[var(--border-default)] text-[var(--text-muted)]'}`}>
                      {at > 0 && (
                        <button type="button" aria-label={STRINGS.overlayKit.moveFieldEarlier(label)} onClick={() => change(row, { fields: moveInList(row.fields, at, -1) })} className="px-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]">‹</button>
                      )}
                      <span className="font-semibold">{label}</span>
                      <span className="max-w-[9rem] truncate" title={value || STRINGS.overlayKit.missingValue}>{value ? `: ${value}` : ` (${STRINGS.overlayKit.missingValue})`}</span>
                      <button type="button" aria-label={STRINGS.overlayKit.removeField(label, n)} onClick={() => change(row, { fields: row.fields.filter((entry) => entry !== field) })} className="px-0.5 text-[var(--text-muted)] hover:text-[var(--semantic-danger)]">×</button>
                    </li>
                  );
                })}
              </ol>
            )}

            {/* Choose, then choose next: a selector that only offers fields this photo has (and your own words). */}
            {grouped.length > 0 && (
              <select aria-label={STRINGS.overlayKit.chooseFieldLabel(n)} value=""
                className="min-h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
                onChange={(event) => { const field = event.target.value; if (isOverlayField(field) && !row.fields.includes(field)) change(row, { fields: [...row.fields, field] }); }}>
                <option value="" disabled>{row.fields.length === 0 ? STRINGS.overlayKit.chooseField : STRINGS.overlayKit.chooseNext}</option>
                {grouped.map(({ group, items }) => (
                  <optgroup key={group} label={STRINGS.overlayKit.groups[group]}>
                    {items.map(([id]) => {
                      const value = id === 'custom' ? '' : overlayFieldText(id, photo);
                      return <option key={id} value={id}>{value ? `${fieldLabel(id)}: ${value}` : fieldLabel(id)}</option>;
                    })}
                  </optgroup>
                ))}
              </select>
            )}

            {row.fields.includes('custom') && (
              <input type="text" value={row.customText} maxLength={200} aria-label={fieldLabel('custom')}
                onChange={(e) => change(row, { customText: e.target.value })}
                placeholder={STRINGS.panelWords.customLine}
                className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]" />
            )}

            {!words && <p className="text-[0.6875rem] text-[var(--text-muted)]">{STRINGS.overlayKit.emptyRow}</p>}

            <FontPicker fonts={fonts} row={row} sample={words.trim() || STRINGS.panelWords.sampleText}
              onSelect={(fontId) => change(row, { fontId })}
              onAddCustomFont={onAddCustomFont} onListDeviceFonts={onListDeviceFonts} onHasDeviceFont={onHasDeviceFont} />

            {/* Size (never past the frame) and capitals */}
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1">
                <label className="flex justify-between text-[0.625rem] text-[var(--text-muted)]">
                  <span>{STRINGS.panelWords.size}</span>
                  <span className="font-mono tabular-nums">{row.sizePx}px</span>
                </label>
                <input type="range" min={8} max={Math.max(8, most)} value={Math.min(row.sizePx, most)} aria-label={`${STRINGS.panelWords.size}: ${STRINGS.overlayKit.rowLabel(n)}`}
                  onChange={(e) => change(row, { sizePx: Number(e.target.value) })} className="inflight-slider" />
                {row.sizePx >= most && words && <p className="text-[0.625rem] text-[var(--text-muted)]">{STRINGS.overlayKit.sizeCapped}</p>}
              </div>
              <button type="button" aria-pressed={row.uppercase} aria-label={STRINGS.overlayKit.capitals} onClick={() => change(row, { uppercase: !row.uppercase })}
                className={`h-8 rounded border px-2 text-[0.625rem] font-semibold ${row.uppercase ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}>
                AA
              </button>
            </div>
          </div>
        );
      })}

      <button type="button" onClick={onAddRow} disabled={rows.length >= MAX_OVERLAY_ROWS}
        className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] text-xs font-semibold text-[var(--brand-accent)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50">
        <BrandIcon name="plus" size={13} />{STRINGS.overlays.addRow}
      </button>
      {rows.length >= MAX_OVERLAY_ROWS && <p className="text-[0.6875rem] text-[var(--text-muted)]">{STRINGS.overlayKit.rowsFull}</p>}
    </div>
  );
}

