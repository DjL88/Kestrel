import React from 'react';
import type { ColourGradeRecipe, EditRecipe } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';

const T = STRINGS.adjust.grade;
const RANGES = ['shadows', 'midtones', 'highlights'] as const;
type Range = typeof RANGES[number];
const STARTING_STRENGTH = 25;
const NEUTRAL: ColourGradeRecipe = { shadows: { hue: 0, amount: 0 }, midtones: { hue: 0, amount: 0 }, highlights: { hue: 0, amount: 0 }, balance: 0 };
/** Nearest named colour family, so the hue is always given in words as well as by the swatch. */
const HUE_NAMES = [[0, 'red'], [30, 'orange'], [60, 'yellow'], [120, 'green'], [180, 'aqua'], [240, 'blue'], [270, 'purple'], [300, 'magenta'], [360, 'red']] as const;
export function hueName(hue: number): keyof typeof T.hueNames {
  let best: (typeof HUE_NAMES)[number] = HUE_NAMES[0];
  for (const entry of HUE_NAMES) if (Math.abs(entry[0] - hue) < Math.abs(best[0] - hue)) best = entry;
  return best[1];
}
const HUE_TRACK = 'linear-gradient(to right, hsl(0 70% 55%), hsl(60 70% 55%), hsl(120 70% 55%), hsl(180 70% 55%), hsl(240 70% 55%), hsl(300 70% 55%), hsl(360 70% 55%))';

interface Props {
  recipe: EditRecipe;
  calmView: boolean;
  onChange: (patch: Partial<EditRecipe>) => void;
}

/** Three-way colour grading: choose a tonal range by name, then its hue and strength; one balance for all three. */
export function ColourGradeControl({ recipe, calmView, onChange, bare = false }: Props & { bare?: boolean }) {
  const [range, setRange] = React.useState<Range>('shadows');
  const grade = recipe.colourGrade ?? NEUTRAL;
  const current = grade[range];
  const set = (patch: Partial<ColourGradeRecipe>) => onChange({ colourGrade: { ...grade, ...patch } });
  // Choosing a hue for a range with no strength gives it a gentle starting strength, so the choice is visible at once
  // (a hue with no strength changes nothing and would not be kept on the photo).
  const setRangeValue = (key: 'hue' | 'amount', value: number) => set({ [range]: {
    ...current, [key]: value, ...(key === 'hue' && current.amount === 0 ? { amount: STARTING_STRENGTH } : {}),
  } } as Partial<ColourGradeRecipe>);
  const readout = (text: string, reset: () => void) => !calmView && (
    <button type="button" onClick={reset} className="font-mono text-[0.6875rem] text-[var(--text-secondary)] tabular-nums hover:text-[var(--brand-accent)]">{text}</button>
  );
  const label = (id: string, text: string, help: string) => (
    <div className="flex items-center gap-1">
      <label htmlFor={id} className="text-xs font-medium text-[var(--text-primary)]">{text}</label>
      <InfoPopover title={text} body={help} />
    </div>
  );
  const name = T.hueNames[hueName(current.hue)];

  return (
    <div className="space-y-2" data-testid="colour-grade">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {!bare && <h4 className="text-xs font-medium text-[var(--text-primary)]">{T.heading}</h4>}
          <InfoPopover title={T.heading} body={T.help} />
        </div>
        <button type="button" onClick={() => onChange({ colourGrade: undefined })}
          className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-[var(--text-muted)] hover:text-[var(--brand-accent)]">
          <BrandIcon name="restore" size={12} />
          <span>{T.reset}</span>
        </button>
      </div>
      <div role="radiogroup" aria-label={T.rangesLabel} className="grid grid-cols-3 gap-1">
        {RANGES.map((id) => {
          const { hue, amount } = grade[id];
          return (
            <button key={id} type="button" role="radio" aria-checked={range === id} onClick={() => setRange(id)}
              className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] border px-1 text-[0.625rem] leading-none ${range === id ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]' : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'}`}>
              {/* The swatch is a secondary cue: its strength is also shown by the dot and the readout. */}
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--border-subtle)]"
                style={{ background: amount > 0 ? `hsl(${hue} ${Math.round(20 + amount * 0.6)}% 55%)` : 'transparent' }} />
              <span>{T.ranges[id]}{amount > 0 && <span aria-hidden="true"> •</span>}</span>
              {amount > 0 && <span className="sr-only">{T.changed}</span>}
            </button>
          );
        })}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          {label('grade-hue', `${T.ranges[range]} ${T.hue.toLowerCase()}`, T.hueHelp)}
          {readout(`${Math.round(current.hue)}° ${T.hueName.replace('{name}', name)}`, () => set({ [range]: { ...current, hue: 0 } } as Partial<ColourGradeRecipe>))}
        </div>
        <input id="grade-hue" type="range" min={0} max={359} step={1} value={current.hue}
          aria-valuetext={`${Math.round(current.hue)} degrees, ${T.hueName.replace('{name}', name)}`}
          onChange={(e) => setRangeValue('hue', Number(e.target.value))} className="inflight-slider" />
        <div aria-hidden="true" className="h-1.5 rounded-full" style={{ background: HUE_TRACK }} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          {label('grade-amount', `${T.ranges[range]} ${T.amount.toLowerCase()}`, T.amountHelp)}
          {readout(String(Math.round(current.amount)), () => setRangeValue('amount', 0))}
        </div>
        <input id="grade-amount" type="range" min={0} max={100} step={1} value={current.amount}
          onChange={(e) => setRangeValue('amount', Number(e.target.value))} className="inflight-slider" />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          {label('grade-balance', T.balance, T.balanceHelp)}
          {readout(`${grade.balance > 0 ? '+' : ''}${Math.round(grade.balance)}`, () => set({ balance: 0 }))}
        </div>
        <input id="grade-balance" type="range" min={-100} max={100} step={1} value={grade.balance}
          onChange={(e) => set({ balance: Number(e.target.value) })} className="inflight-slider" />
      </div>
    </div>
  );
}
