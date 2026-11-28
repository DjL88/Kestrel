import React from 'react';
import { COLLAGE_FORMATS, type CollageFormat } from '../../../core/collage';
import {
  CUSTOM_EDGE_MAX, CUSTOM_EDGE_MIN, PRINT_DPI_CHOICES, collageSocialSize, customLongEdge, isPrintDpi,
  type CollageOutput, type CollageWindowCheck, type PrintDpi,
} from '../../../core/collageOutput';
import { collageOutputText as T } from '../../../i18n/areas/collageOutput';
import BrandIcon from '../icons/BrandIcon';

interface Props {
  format: CollageFormat;
  output: CollageOutput;
  onChange: (output: CollageOutput) => void;
  /** Each window at this output, from the photographs' recorded sizes. */
  checks: CollageWindowCheck[];
  disabled?: boolean;
}

/**
 * Collage export choices (a preview): the export size for a social page (standard, twice, or a chosen long edge) or the
 * print resolution for an album, and every window's real pixels at that size before anything is rendered. A window that
 * would be enlarged or print below the chosen resolution says so in words, with a warning sign as well as the text.
 */
export default function CollageOutputChoices({ format, output, onChange, checks, disabled = false }: Props) {
  const paper = COLLAGE_FORMATS[format].unit === 'mm';
  const standard = paper ? null : collageSocialSize(format, { kind: 'x1' });
  const double = paper ? null : collageSocialSize(format, { kind: 'x2' });
  const [edgeText, setEdgeText] = React.useState(() => String(output.kind === 'social' && output.scale.kind === 'custom'
    ? output.scale.longEdge : Math.max(double?.width ?? 0, double?.height ?? 0)));
  const custom = output.kind === 'social' && output.scale.kind === 'custom' ? collageSocialSize(format, output.scale) : null;

  return (
    <div className="space-y-3" data-testid="collage-output-choices">
      {paper ? (
        <label className="block font-medium">{T.dpi}
          <select data-testid="collage-print-dpi" disabled={disabled} className="block mt-2 w-full rounded border bg-[var(--bg-surface)] p-2"
            value={output.kind === 'print' ? output.dpi : 300}
            onChange={(event) => { const dpi = Number(event.target.value); if (isPrintDpi(dpi)) onChange({ kind: 'print', dpi: dpi as PrintDpi }); }}>
            {PRINT_DPI_CHOICES.map((dpi) => <option key={dpi} value={dpi}>{T.dpiOption(dpi)}</option>)}
          </select>
        </label>
      ) : (
        <fieldset className="space-y-1" disabled={disabled}>
          <legend className="font-medium">{T.size}</legend>
          {([['x1', T.standard(standard!.width, standard!.height)], ['x2', T.double(double!.width, double!.height)], ['custom', T.custom]] as const).map(([kind, label]) => (
            <label key={kind} className="flex items-center gap-2 min-h-10">
              <input type="radio" name="collage-scale" data-testid={`collage-scale-${kind}`}
                checked={output.kind === 'social' && output.scale.kind === kind}
                onChange={() => onChange({ kind: 'social', scale: kind === 'custom' ? { kind, longEdge: customLongEdge(Number(edgeText)) ?? CUSTOM_EDGE_MIN } : { kind } })} />
              {label}
            </label>
          ))}
          {output.kind === 'social' && output.scale.kind === 'custom' && (
            <div className="flex flex-wrap items-center gap-3 pl-6">
              <label className="text-sm">{T.customEdge}
                <input data-testid="collage-custom-edge" className="ml-2 w-24 rounded border p-1" type="number" inputMode="numeric"
                  min={CUSTOM_EDGE_MIN} max={CUSTOM_EDGE_MAX} step={1} value={edgeText}
                  onChange={(event) => {
                    setEdgeText(event.target.value);
                    const edge = customLongEdge(Number(event.target.value));
                    if (edge !== null && event.target.value !== '') onChange({ kind: 'social', scale: { kind: 'custom', longEdge: edge } });
                  }} />
              </label>
              {custom && <span className="text-sm tabular-nums text-[var(--text-secondary)]" data-testid="collage-custom-size">{T.customSize(custom.width, custom.height)}</span>}
            </div>
          )}
        </fieldset>
      )}

      {checks.length > 0 && (
        <section aria-labelledby="collage-windows-heading" className="space-y-2">
          <h3 id="collage-windows-heading" className="font-medium">{T.windows}</h3>
          <ul className="space-y-2 text-sm" data-testid="collage-window-checks">
            {checks.map((check) => {
              const status = check.ppi !== null
                ? (check.low && output.kind === 'print' ? T.lowPpi(check.ppi, output.dpi) : T.ppi(check.ppi))
                : check.enlargement !== null ? (check.low ? T.enlarged(Math.round(check.enlargement * 100)) : T.sharp) : '';
              return (
                <li key={`${check.page}-${check.window}`} data-testid="collage-window-check" data-low={check.low ? 'true' : undefined}
                  className="rounded border border-[var(--border-subtle)] p-2">
                  <p className="font-medium break-words">{T.window(check.page, check.window, check.filename)}</p>
                  <p className="tabular-nums text-[var(--text-secondary)]">{check.sourcePx
                    ? T.pixels(check.sourcePx.width, check.sourcePx.height, check.windowPx.width, check.windowPx.height)
                    : T.unknown(check.windowPx.width, check.windowPx.height)}</p>
                  {status && (
                    <p className="flex items-start gap-1.5">
                      <BrandIcon name={check.low ? 'alert' : 'check'} size={14} className="mt-0.5 shrink-0" />
                      <span>{status}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className="text-sm text-[var(--text-secondary)]">{T.rawNote}</p>
    </div>
  );
}
