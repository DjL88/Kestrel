import { useSliderValue } from '../utils/useSliderValue';
import React from 'react';
import ColourCheckerDialog from '../dialogs/ColourCheckerDialog';
import type { CheckerFit } from '../../../core/colourChecker';
import type { EditRecipe } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';

const T = STRINGS.adjust.effects;
const C = STRINGS.adjust.calibration;
const DEFAULT_VIGNETTE_SIZE = 50;
const DEFAULT_GRAIN_SIZE = 25;
const DEFAULT_VIGNETTE_FEATHER = 50;
/** A muted warm brown, a common starting colour for a coloured vignette. */
const STARTING_COLOUR = '#3a2a1e';

interface Props {
  recipe: EditRecipe;
  calmView: boolean;
  onChange: (patch: Partial<EditRecipe>) => void;
}

interface RowProps {
  id: string;
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  calmView: boolean;
  disabled?: boolean;
  leftHint?: string;
  rightHint?: string;
  onChange: (value: number) => void;
  reset?: number;
}

function Row({ id, label, help, value: workspaceValue, min, max, calmView, disabled, leftHint, rightHint, onChange: commit, reset = 0 }: RowProps) {
  // The thumb moves at once; the edit follows as a transition, so dragging never waits for the editor.
  const [value, onChange] = useSliderValue(workspaceValue, commit);
  return (
    <div className={`space-y-1.5 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <label htmlFor={id} className="text-xs font-medium text-[var(--text-primary)]">{label}</label>
          <InfoPopover title={label} body={help} />
        </div>
        {!calmView && (
          <button type="button" disabled={disabled} onClick={() => onChange(reset)}
            className="font-mono text-[0.6875rem] text-[var(--text-secondary)] tabular-nums hover:text-[var(--brand-accent)]">
            {`${value > 0 && min < 0 ? '+' : ''}${Math.round(value)}`}
          </button>
        )}
      </div>
      <input id={id} type="range" min={min} max={max} step={1} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} className="inflight-slider" />
      {(leftHint || rightHint) && (
        <div className="flex items-center justify-between text-[0.625rem] text-[var(--text-muted)]">
          <span>{leftHint}</span>
          <span>{rightHint}</span>
        </div>
      )}
    </div>
  );
}

/** Dehaze, vignette (darker, lighter, a colour, and optional blur) and grain: the standard editor's Effects. */
export function EffectsControls({ recipe, calmView, onChange }: Props) {
  const vignette = recipe.vignette ?? 0;
  const blur = recipe.vignetteBlur ?? 0;
  const colour = recipe.vignetteColour;
  const vignetteOn = vignette !== 0 || blur > 0;
  const grain = recipe.grain ?? 0;
  return (
    <div className="space-y-3" data-testid="effects">
      <Row id="slider-dehaze" label={T.dehaze} help={T.dehazeHelp} value={recipe.dehaze ?? 0} min={-100} max={100} calmView={calmView}
        leftHint={T.addHaze} rightHint={T.removeHaze} onChange={(v) => onChange({ dehaze: v })} />

      <div className="space-y-2" role="group" aria-labelledby="vignette-heading">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <h4 id="vignette-heading" className="text-xs font-medium text-[var(--text-primary)]">{T.vignette}</h4>
            <InfoPopover title={T.vignette} body={T.vignetteHelp} />
          </div>
          <button type="button" onClick={() => onChange({ vignette: 0, vignetteBlur: 0, vignetteSize: DEFAULT_VIGNETTE_SIZE, vignetteColour: undefined, vignetteRoundness: 0, vignetteFeather: DEFAULT_VIGNETTE_FEATHER, vignetteHighlights: 0 })}
            className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-[var(--text-muted)] hover:text-[var(--brand-accent)]">
            <BrandIcon name="restore" size={12} />
            <span>{T.resetVignette}</span>
          </button>
        </div>
        <div role="radiogroup" aria-label={T.vignetteKind} className="grid grid-cols-2 gap-1">
          {([['tone', T.darkerLighter], ['colour', T.colour]] as const).map(([kind, label]) => {
            const chosen = (kind === 'colour') === !!colour;
            return (
              <button key={kind} type="button" role="radio" aria-checked={chosen}
                onClick={() => {
                  if (chosen) return;
                  // A colour vignette uses strength only; it starts visible so the choice shows at once.
                  if (kind === 'colour') onChange({ vignetteColour: STARTING_COLOUR, vignette: Math.max(40, Math.abs(vignette)) });
                  else onChange({ vignetteColour: undefined, vignette: -Math.abs(vignette) });
                }}
                className={`min-h-8 rounded-[var(--radius-sm)] border px-1 text-[0.6875rem] ${chosen ? 'border-[var(--brand-accent)] text-[var(--brand-accent)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
                {label}
              </button>
            );
          })}
        </div>
        {colour ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="vignette-colour" className="text-xs font-medium text-[var(--text-primary)]">{T.colourPick}</label>
              <span className="flex items-center gap-2">
                <span className="font-mono text-[0.6875rem] uppercase text-[var(--text-secondary)]">{colour}</span>
                <input id="vignette-colour" type="color" value={colour} onChange={(e) => onChange({ vignetteColour: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border border-[var(--border-subtle)] bg-transparent" />
              </span>
            </div>
            <Row id="slider-vignette" label={T.colourStrength} help={T.colourStrengthHelp} value={Math.abs(vignette)} min={0} max={100}
              calmView={calmView} onChange={(v) => onChange({ vignette: v })} />
          </>
        ) : (
          <Row id="slider-vignette" label={T.amount} help={T.amountHelp} value={vignette} min={-100} max={100} calmView={calmView}
            leftHint={T.darker} rightHint={T.lighter} onChange={(v) => onChange({ vignette: v })} />
        )}
        <Row id="slider-vignette-blur" label={T.blur} help={T.blurHelp} value={blur} min={0} max={100} calmView={calmView}
          onChange={(v) => onChange({ vignetteBlur: v })} />
        <Row id="slider-vignette-size" label={T.size} help={vignetteOn ? T.sizeHelp : T.sizeOff} value={recipe.vignetteSize ?? DEFAULT_VIGNETTE_SIZE}
          min={0} max={100} calmView={calmView} disabled={!vignetteOn} reset={DEFAULT_VIGNETTE_SIZE} onChange={(v) => onChange({ vignetteSize: v })} />
        <Row id="slider-vignette-roundness" label={T.roundness} help={vignetteOn ? T.roundnessHelp : T.shapeOff} value={recipe.vignetteRoundness ?? 0}
          min={-100} max={100} calmView={calmView} disabled={!vignetteOn} leftHint={T.rectangle} rightHint={T.circle} onChange={(v) => onChange({ vignetteRoundness: v })} />
        <Row id="slider-vignette-feather" label={T.feather} help={vignetteOn ? T.featherHelp : T.shapeOff} value={recipe.vignetteFeather ?? DEFAULT_VIGNETTE_FEATHER}
          min={0} max={100} calmView={calmView} disabled={!vignetteOn} reset={DEFAULT_VIGNETTE_FEATHER} leftHint={T.hard} rightHint={T.soft}
          onChange={(v) => onChange({ vignetteFeather: v })} />
        <Row id="slider-vignette-highlights" label={T.highlights} help={vignetteOn ? T.highlightsHelp : T.shapeOff} value={recipe.vignetteHighlights ?? 0}
          min={0} max={100} calmView={calmView} disabled={!vignetteOn || (!colour && vignette > 0)} onChange={(v) => onChange({ vignetteHighlights: v })} />
      </div>

      <Row id="slider-grain" label={T.grain} help={T.grainHelp} value={grain} min={0} max={100} calmView={calmView} onChange={(v) => onChange({ grain: v })} />
      <Row id="slider-grain-size" label={T.grainSize} help={grain > 0 ? T.grainSizeHelp : T.grainSizeOff} value={recipe.grainSize ?? DEFAULT_GRAIN_SIZE}
        min={0} max={100} calmView={calmView} disabled={grain === 0} reset={DEFAULT_GRAIN_SIZE}
        leftHint={T.fine} rightHint={T.coarse} onChange={(v) => onChange({ grainSize: v })} />
      <Row id="slider-grain-roughness" label={T.roughness} help={grain > 0 ? T.roughnessHelp : T.roughnessOff} value={recipe.grainRoughness ?? 0}
        min={0} max={100} calmView={calmView} disabled={grain === 0} leftHint={T.smooth} rightHint={T.rough}
        onChange={(v) => onChange({ grainRoughness: v })} />
    </div>
  );
}

const PRIMARIES = ['red', 'green', 'blue'] as const;
type Primary = typeof PRIMARIES[number];

/** Advanced: camera calibration, choose a primary by name, then its hue and saturation. */
export function CalibrationControl({ recipe, calmView, onChange, pictureUrl }: Props & { pictureUrl?: string }) {
  const [primary, setPrimary] = React.useState<Primary>('red');
  const [checkerOpen, setCheckerOpen] = React.useState(false);
  const [checkerNote, setCheckerNote] = React.useState('');
  const applyChecker = (fit: CheckerFit) => {
    const pct = (v: number) => Math.round(v * 100);
    onChange({ calibration: Object.fromEntries(PRIMARIES.map((p) => [p, { hue: pct(fit.calibration[p][0]), saturation: pct(fit.calibration[p][1]) }])) as NonNullable<EditRecipe['calibration']> });
    const one = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    setCheckerNote(C.checkerResult(one(fit.before), one(fit.after)));
    setCheckerOpen(false);
  };
  const zero = { hue: 0, saturation: 0 };
  const calibration = recipe.calibration ?? { red: zero, green: zero, blue: zero };
  const current = calibration[primary];
  const set = (key: 'hue' | 'saturation', value: number) => onChange({ calibration: { ...calibration, [primary]: { ...current, [key]: value } } });
  const changed = (p: Primary) => calibration[p].hue !== 0 || calibration[p].saturation !== 0;
  return (
    <div className="space-y-2" data-testid="calibration">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h4 className="text-xs font-medium text-[var(--text-primary)]">{C.heading}</h4>
          <InfoPopover title={C.heading} body={C.help} />
        </div>
        <button type="button" onClick={() => onChange({ calibration: undefined })}
          className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-[var(--text-muted)] hover:text-[var(--brand-accent)]">
          <BrandIcon name="restore" size={12} />
          <span>{C.reset}</span>
        </button>
      </div>
      <div role="radiogroup" aria-label={C.primariesLabel} className="grid grid-cols-3 gap-1">
        {PRIMARIES.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={primary === p} onClick={() => setPrimary(p)}
            className={`min-h-8 rounded-[var(--radius-sm)] border px-1 text-[0.6875rem] ${primary === p ? 'border-[var(--brand-accent)] text-[var(--brand-accent)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
            {C.primaries[p]}{changed(p) && <span aria-hidden="true"> •</span>}
            {changed(p) && <span className="sr-only">{C.changed}</span>}
          </button>
        ))}
      </div>
      <Row id="calibration-hue" label={`${C.primaries[primary]} ${C.hue.toLowerCase()}`} help={C.hueHelp} value={current.hue} min={-100} max={100}
        calmView={calmView} onChange={(v) => set('hue', v)} />
      <Row id="calibration-saturation" label={`${C.primaries[primary]} ${C.saturation.toLowerCase()}`} help={C.saturationHelp} value={current.saturation}
        min={-100} max={100} calmView={calmView} onChange={(v) => set('saturation', v)} />
      {pictureUrl && (
        <button type="button" onClick={() => { setCheckerNote(''); setCheckerOpen(true); }}
          className="min-h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 text-[0.6875rem] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          {C.checkerButton}
        </button>
      )}
      {checkerNote && <p role="status" className="text-[0.6875rem] text-[var(--text-secondary)]">{checkerNote}</p>}
      {checkerOpen && pictureUrl && <ColourCheckerDialog pictureUrl={pictureUrl} onApply={applyChecker} onClose={() => setCheckerOpen(false)} />}
    </div>
  );
}
