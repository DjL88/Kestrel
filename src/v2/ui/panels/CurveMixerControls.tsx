import React from 'react';
import type { EditRecipe } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';
import { addCurvePoint, CURVE_PRESETS, curvePath, moveCurvePoint, removeCurvePoint, type CurvePresetId, type UiCurvePoint } from '../utils/curveEditing';

const T = STRINGS.adjust;
const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
/** Swatches are a secondary cue only: every band also has its name, so nothing depends on seeing colour. */
const SWATCH: Record<typeof BANDS[number], string> = {
  red: '#d9534f', orange: '#e8893a', yellow: '#e6c84a', green: '#5aa65a', aqua: '#4bb5b5', blue: '#4a7fd4', purple: '#8b62c9', magenta: '#c95aa8',
};
const STRAIGHT: UiCurvePoint[] = [[0, 0], [1, 1]];
const SIZE = 200;
/** Room round the graph so the end points are drawn whole. */
const PAD = 9;

interface Props {
  recipe: EditRecipe;
  calmView: boolean;
  onChange: (patch: Partial<EditRecipe>) => void;
}

type CurveChannel = 'all' | 'red' | 'green' | 'blue';
const CURVE_CHANNEL_IDS: CurveChannel[] = ['all', 'red', 'green', 'blue'];
/** Line colour is a secondary cue only: the chosen channel is always named on its button and in the graph's label. */
const CHANNEL_STROKE: Record<CurveChannel, string> = { all: 'var(--text-primary)', red: '#d9534f', green: '#5aa65a', blue: '#4a7fd4' };

/**
 * Tone curve: an SVG graph with draggable, keyboard-movable points and plain-word presets. With `channels` (the
 * advanced controls setting) it also edits separate red, green and blue curves, applied after the main one.
 */
export function ToneCurveControl({ recipe, onChange, channels = false }: Props & { channels?: boolean }) {
  const [chosen, setChannel] = React.useState<CurveChannel>('all');
  const channel: CurveChannel = channels ? chosen : 'all';
  const source = channel === 'all' ? recipe.toneCurve : recipe.channelCurves?.[channel];
  const points = source && source.length >= 2 ? source : STRAIGHT;
  const [selected, setSelected] = React.useState<number | null>(null);
  const dragging = React.useRef<number | null>(null);
  const svg = React.useRef<SVGSVGElement>(null);
  const toCurve = (event: React.PointerEvent): UiCurvePoint => {
    const box = svg.current!.getBoundingClientRect();
    const scale = (SIZE + 2 * PAD) / box.width;
    return [
      Math.min(1, Math.max(0, ((event.clientX - box.left) * scale - PAD) / SIZE)),
      Math.min(1, Math.max(0, 1 - ((event.clientY - box.top) * scale - PAD) / SIZE)),
    ];
  };
  const set = (next: UiCurvePoint[]) => onChange(channel === 'all' ? { toneCurve: next } : { channelCurves: { ...recipe.channelCurves, [channel]: next } });

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const target = (event.target as Element).getAttribute('data-index');
    if (target !== null) {
      dragging.current = Number(target);
    } else {
      const added = addCurvePoint(points, toCurve(event));
      if (!added) return;
      set(added.points);
      dragging.current = added.index;
    }
    setSelected(dragging.current);
    svg.current?.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragging.current === null) return;
    set(moveCurvePoint(points, dragging.current, toCurve(event)));
  };
  const onPointerUp = () => { dragging.current = null; };
  const onKeyDown = (index: number) => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const [x, y] = points[index];
    const moves: Record<string, UiCurvePoint> = {
      ArrowUp: [x, y + step], ArrowDown: [x, y - step], ArrowLeft: [x - step, y], ArrowRight: [x + step, y],
    };
    if (moves[event.key]) {
      event.preventDefault();
      set(moveCurvePoint(points, index, moves[event.key]));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const next = removeCurvePoint(points, index);
      if (next) { set(next); setSelected(null); }
    }
  };
  const label = (point: UiCurvePoint) => T.curve.pointValue.replace('{x}', String(Math.round(point[0] * 100))).replace('{y}', String(Math.round(point[1] * 100)));

  return (
    <div className="space-y-2" data-testid="tone-curve">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h4 className="text-xs font-medium text-[var(--text-primary)]">{T.curve.heading}</h4>
          <InfoPopover title={T.curve.heading} body={T.curve.help} />
        </div>
        <button type="button" onClick={() => { set(STRAIGHT); setSelected(null); }}
          className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-[var(--text-muted)] hover:text-[var(--brand-accent)]">
          <BrandIcon name="restore" size={12} />
          <span>{T.curve.reset}</span>
        </button>
      </div>
      {channels && (
        <div role="radiogroup" aria-label={T.curve.channelsLabel} className="grid grid-cols-4 gap-1">
          {CURVE_CHANNEL_IDS.map((id) => {
            const bent = id !== 'all' && !!recipe.channelCurves?.[id];
            return (
              <button key={id} type="button" role="radio" aria-checked={channel === id} onClick={() => { setChannel(id); setSelected(null); }}
                className={`min-h-8 rounded-[var(--radius-sm)] border px-1 text-[0.6875rem] ${channel === id ? 'border-[var(--brand-accent)] text-[var(--brand-accent)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
                {T.curve.channels[id]}{bent && <span aria-hidden="true"> •</span>}
                {bent && <span className="sr-only">{T.mixer.changed}</span>}
              </button>
            );
          })}
        </div>
      )}
      <svg ref={svg} viewBox={`${-PAD} ${-PAD} ${SIZE + 2 * PAD} ${SIZE + 2 * PAD}`} role="group"
        aria-label={channel === 'all' ? T.curve.graphLabel : `${T.curve.channels[channel]}. ${T.curve.graphLabel}`}
        className="aspect-square w-full touch-none select-none rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)]"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <rect x={0} y={0} width={SIZE} height={SIZE} fill="none" stroke="var(--border-subtle)" strokeWidth={1} />
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="var(--border-subtle)" strokeWidth={1}>
            <line x1={g * SIZE} y1={0} x2={g * SIZE} y2={SIZE} />
            <line x1={0} y1={g * SIZE} x2={SIZE} y2={g * SIZE} />
          </g>
        ))}
        <line x1={0} y1={SIZE} x2={SIZE} y2={0} stroke="var(--border-default)" strokeDasharray="4 4" strokeWidth={1} />
        <path d={curvePath(points, SIZE)} fill="none" stroke={CHANNEL_STROKE[channel]} strokeWidth={2} />
        {points.map((point, index) => (
          <circle key={index} data-index={index} cx={point[0] * SIZE} cy={(1 - point[1]) * SIZE} r={selected === index ? 7 : 6}
            role="slider" tabIndex={0} aria-label={T.curve.pointLabel} aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(point[1] * 100)} aria-valuetext={label(point)}
            onFocus={() => setSelected(index)} onKeyDown={onKeyDown(index)}
            fill={selected === index ? 'var(--brand-accent)' : 'var(--bg-surface)'} stroke="var(--text-primary)" strokeWidth={2}
            className="cursor-grab focus:outline-none" />
        ))}
      </svg>
      <div role="group" aria-label={T.curve.presetsLabel} className="flex flex-wrap gap-1.5">
        {(Object.keys(CURVE_PRESETS) as CurvePresetId[]).map((id) => (
          <button key={id} type="button" onClick={() => { set(CURVE_PRESETS[id]); setSelected(null); }}
            className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 py-1 text-[0.6875rem] text-[var(--text-secondary)] hover:border-[var(--border-default)]">
            {T.curve[id]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Colour mixer: choose a colour family by name, then Hue, Saturation and Luminance for it. */
export function ColourMixerControl({ recipe, calmView, onChange }: Props) {
  const [band, setBand] = React.useState(0);
  const zero = () => Array<number>(8).fill(0);
  const mixer = recipe.colourMixer ?? { hue: zero(), saturation: zero(), luminance: zero() };
  const changed = (i: number) => mixer.hue[i] !== 0 || mixer.saturation[i] !== 0 || mixer.luminance[i] !== 0;
  const setValue = (key: 'hue' | 'saturation' | 'luminance', value: number) => {
    const list = [...mixer[key]];
    list[band] = value;
    onChange({ colourMixer: { ...mixer, [key]: list } });
  };
  const rows = [
    { key: 'hue' as const, label: T.mixer.hue, help: T.mixer.hueHelp },
    { key: 'saturation' as const, label: T.mixer.saturation, help: T.mixer.saturationHelp },
    { key: 'luminance' as const, label: T.mixer.luminance, help: T.mixer.luminanceHelp },
  ];
  return (
    <div className="space-y-2" data-testid="colour-mixer">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h4 className="text-xs font-medium text-[var(--text-primary)]">{T.mixer.heading}</h4>
          <InfoPopover title={T.mixer.heading} body={T.mixer.help} />
        </div>
        <button type="button" onClick={() => onChange({ colourMixer: undefined })}
          className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-[var(--text-muted)] hover:text-[var(--brand-accent)]">
          <BrandIcon name="restore" size={12} />
          <span>{T.mixer.reset}</span>
        </button>
      </div>
      <div role="radiogroup" aria-label={T.mixer.bandsLabel} className="grid grid-cols-4 gap-1">
        {BANDS.map((name, i) => (
          <button key={name} type="button" role="radio" aria-checked={band === i} onClick={() => setBand(i)}
            className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] border px-1 text-[0.625rem] leading-none ${band === i ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]' : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'}`}>
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SWATCH[name] }} />
            <span>{T.mixer.bands[name]}{changed(i) && <span aria-hidden="true"> •</span>}</span>
            {changed(i) && <span className="sr-only">{T.mixer.changed}</span>}
          </button>
        ))}
      </div>
      {rows.map((row) => {
        const id = `mixer-${row.key}`;
        const value = mixer[row.key][band];
        return (
          <div key={row.key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <label htmlFor={id} className="text-xs font-medium text-[var(--text-primary)]">{`${T.mixer.bands[BANDS[band]]} ${row.label.toLowerCase()}`}</label>
                <InfoPopover title={row.label} body={row.help} />
              </div>
              {!calmView && (
                <button type="button" onClick={() => setValue(row.key, 0)}
                  className="font-mono text-[0.6875rem] text-[var(--text-secondary)] tabular-nums hover:text-[var(--brand-accent)]">
                  {`${value > 0 ? '+' : ''}${Math.round(value)}`}
                </button>
              )}
            </div>
            <input id={id} type="range" min={-100} max={100} step={1} value={value}
              onChange={(e) => setValue(row.key, Number(e.target.value))} className="inflight-slider" />
          </div>
        );
      })}
    </div>
  );
}

const KELVIN_LOW = 2500;
const KELVIN_HIGH = 12000;
const formatK = (k: number) => `${Math.round(k).toLocaleString('en-GB')} K`;

/** White balance in kelvin, for RAW photos whose decoder estimated the as-shot white. */
export function KelvinControl({ recipe, asShotK, calmView, onChange }: Props & { asShotK: number }) {
  const value = recipe.whiteBalance?.kelvin ?? asShotK;
  const set = (kelvin: number) => onChange({ whiteBalance: Math.round(kelvin) === Math.round(asShotK) ? undefined : { asShotK, kelvin } });
  return (
    <div className="space-y-1.5" data-testid="white-balance-kelvin">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <label htmlFor="slider-kelvin" className="text-xs font-medium text-[var(--text-primary)]">{T.kelvin.label}</label>
          <InfoPopover title={T.kelvin.label} body={T.kelvin.help} />
        </div>
        {!calmView && (
          <button type="button" onClick={() => set(asShotK)}
            className="font-mono text-[0.6875rem] text-[var(--text-secondary)] tabular-nums hover:text-[var(--brand-accent)]">
            {formatK(value)}
          </button>
        )}
      </div>
      <input id="slider-kelvin" type="range" min={KELVIN_LOW} max={KELVIN_HIGH} step={50}
        value={Math.min(KELVIN_HIGH, Math.max(KELVIN_LOW, value))} aria-valuetext={formatK(value)}
        onChange={(e) => set(Number(e.target.value))} className="inflight-slider" />
      <div className="flex items-center justify-between text-[0.625rem] text-[var(--text-muted)]">
        <span>{T.kelvin.cooler}</span>
        <span>{T.kelvin.asShot.replace('{k}', Math.round(asShotK).toLocaleString('en-GB'))}</span>
        <span>{T.kelvin.warmer}</span>
      </div>
    </div>
  );
}
