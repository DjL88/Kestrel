import React, { useEffect, useRef, useState } from 'react';
import type { FontOption, OverlayTextRow } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';

interface FontPickerProps {
  fonts: FontOption[];
  row: OverlayTextRow;
  /** The words shown in the sample, so the font is judged on what it will say. */
  sample: string;
  onSelect: (fontId: string) => void;
  onAddCustomFont: (fontName: string) => void;
  onListDeviceFonts: () => Promise<string[] | null>;
  onHasDeviceFont: (fontName: string) => boolean;
}

const MAX_DEVICE_ROWS = 60;

/**
 * Pick a font by looking at it. Our favourites come first, each drawn in its own typeface, then any the person added
 * from this device. "Add from this device" lists the installed fonts with a search (where the device allows it) or
 * lets a name be typed and checked. A font on this device is marked as such: it is on this computer only.
 */
export default function FontPicker({ fonts, row, sample, onSelect, onAddCustomFont, onListDeviceFonts, onHasDeviceFont }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [deviceList, setDeviceList] = useState<string[] | null | undefined>(undefined); // undefined: not asked yet
  const [deviceQuery, setDeviceQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [showDevice, setShowDevice] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const active = fonts.find((font) => font.id === row.fontId) ?? fonts[0];

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const favourites = fonts.filter((font) => !font.isDevice && `${font.label} ${font.category}`.toLowerCase().includes(needle));
  const mine = fonts.filter((font) => font.isDevice && font.label.toLowerCase().includes(needle));
  const installed = deviceList ?? [];
  const deviceMatches = installed.filter((name) => name.toLowerCase().includes(deviceQuery.trim().toLowerCase()));
  const typedName = typed.trim();
  const typedKnown = typedName ? onHasDeviceFont(typedName) : false;

  const choose = (font: FontOption) => { onSelect(font.id); setOpen(false); };
  const addDevice = (name: string) => {
    onAddCustomFont(name);
    // The new font is first in "On this device"; the person picks it from there, so nothing changes under them.
    setTyped(''); setDeviceQuery('');
  };
  const browseDevice = async () => {
    setShowDevice(true);
    if (deviceList === undefined) setDeviceList(await onListDeviceFonts());
  };

  const item = (font: FontOption) => (
    <button key={font.id} type="button" onClick={() => choose(font)} aria-pressed={font.id === row.fontId}
      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors ${
        font.id === row.fontId ? 'bg-[var(--brand-accent-soft)] text-[var(--text-primary)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
      }`}>
      <span style={{ fontFamily: font.family }} className="min-w-0 truncate text-base">{font.label}</span>
      <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--text-secondary)]">
        {font.isDevice ? STRINGS.overlays.fontOnThisDevice : font.category}
        {font.id === row.fontId && <BrandIcon name="check" size={12} className="text-[var(--brand-accent)]" />}
      </span>
    </button>
  );

  return (
    <div className="relative" ref={root}>
      <button type="button" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 text-sm text-[var(--text-primary)]">
        <span style={{ fontFamily: active.family }} className="truncate">{active.label}</span>
        <BrandIcon name="chevron-down" size={13} className="text-[var(--text-secondary)]" />
      </button>
      {/* What the chosen font looks like, at this row's size, weight and case. */}
      <p data-testid="font-sample" className="mt-1.5 truncate rounded-[var(--radius-xs)] bg-[var(--bg-input)] px-2 py-1.5 text-[var(--text-primary)]"
        style={{ fontFamily: active.family, fontWeight: row.weight, fontSize: Math.min(row.sizePx, 22), textTransform: row.uppercase ? 'uppercase' : 'none', letterSpacing: `${row.letterSpacing}px` }}>
        {sample}
      </p>

      {open && (
        <div role="listbox" aria-label={STRINGS.overlays.fontListLabel}
          className="absolute left-0 right-0 z-30 mt-1.5 max-h-80 overflow-y-auto inflight-scroll rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-2 shadow-[var(--shadow-popover)]">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={STRINGS.overlays.fontSearchPlaceholder}
            aria-label={STRINGS.overlays.fontSearchPlaceholder}
            className="mb-2 h-8 w-full rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]" />
          {favourites.length > 0 && <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{STRINGS.overlays.fontFavourites}</p>}
          <div className="space-y-0.5">{favourites.map(item)}</div>
          {mine.length > 0 && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{STRINGS.overlays.fontOnThisDevice}</p>}
          <div className="space-y-0.5">{mine.map(item)}</div>
          {favourites.length + mine.length === 0 && <p className="px-2 py-2 text-xs text-[var(--text-secondary)]">{STRINGS.overlays.fontNoMatch}</p>}

          <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
            {!showDevice ? (
              <button type="button" onClick={browseDevice}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                <BrandIcon name="plus" size={13} />{STRINGS.overlays.fontAddFromDevice}
              </button>
            ) : deviceList === undefined ? (
              <p role="status" className="px-2 py-1 text-xs text-[var(--text-secondary)]">{STRINGS.overlays.fontLoading}</p>
            ) : deviceList ? (
              <div className="space-y-1">
                <input type="search" value={deviceQuery} onChange={(event) => setDeviceQuery(event.target.value)} placeholder={STRINGS.overlays.fontSearchDevice}
                  aria-label={STRINGS.overlays.fontSearchDevice}
                  className="h-8 w-full rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]" />
                {deviceMatches.slice(0, MAX_DEVICE_ROWS).map((name) => (
                  <button key={name} type="button" onClick={() => addDevice(name)}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--bg-surface-hover)]">
                    <span style={{ fontFamily: `"${name}", sans-serif` }} className="min-w-0 truncate text-base text-[var(--text-primary)]">{name}</span>
                    <span className="shrink-0 text-[10px] font-medium text-[var(--brand-accent)]">{STRINGS.overlays.fontAdd}</span>
                  </button>
                ))}
                {deviceMatches.length > MAX_DEVICE_ROWS && <p className="px-2 text-[11px] text-[var(--text-secondary)]">{STRINGS.overlays.fontKeepTyping(deviceMatches.length - MAX_DEVICE_ROWS)}</p>}
                {deviceMatches.length === 0 && <p className="px-2 py-1 text-xs text-[var(--text-secondary)]">{STRINGS.overlays.fontNoMatch}</p>}
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="px-1 text-[11px] leading-snug text-[var(--text-secondary)]">{STRINGS.overlays.fontCannotList}</p>
                <div className="flex gap-1">
                  <input type="text" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={STRINGS.overlays.fontTypeName} aria-label={STRINGS.overlays.fontTypeName}
                    className="h-8 min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]" />
                  <button type="button" disabled={!typedKnown} onClick={() => addDevice(typedName)}
                    className="h-8 rounded bg-[var(--brand-accent)] px-2.5 text-xs font-semibold text-[var(--text-on-accent)] disabled:opacity-50">{STRINGS.overlays.fontAdd}</button>
                </div>
                {typedName && (
                  <p role="status" className="px-1 text-xs text-[var(--text-primary)]" style={typedKnown ? { fontFamily: `"${typedName}", sans-serif`, fontSize: 16 } : undefined}>
                    {typedKnown ? sample : STRINGS.overlays.fontNotFound(typedName)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
