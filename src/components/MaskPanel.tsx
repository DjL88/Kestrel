import { Eraser, Paintbrush, Plus, Trash2 } from 'lucide-react';
import { LOCAL_KEYS, MAX_MASKS, createMask, type LocalKey, type Mask } from '../core/maskTypes';

const LABELS: Record<LocalKey, string> = {
  exposure: 'Light', warmth: 'Warmth', colour: 'Colour', contrast: 'Contrast', highlights: 'Highlights',
  shadows: 'Shadows', whites: 'Whites', blacks: 'Blacks', vibrance: 'Vibrance',
};
const KIND_NAMES = { linear: 'Gradient', radial: 'Oval', brush: 'Brush' } as const;

export function maskName(masks: Mask[], mask: Mask): string {
  const same = masks.filter((candidate) => candidate.kind === mask.kind);
  return `${KIND_NAMES[mask.kind]} ${same.indexOf(mask) + 1}`;
}

interface Props {
  masks: Mask[];
  selectedId: string | null;
  disabled: boolean;
  brushRadius: number;
  erase: boolean;
  showOverlay: boolean;
  onSelect: (id: string | null) => void;
  onChange: (masks: Mask[]) => void;
  onBrushRadius: (radius: number) => void;
  onErase: (erase: boolean) => void;
  onShowOverlay: (show: boolean) => void;
}

export function MaskPanel(props: Props) {
  const { masks, selectedId, disabled, brushRadius, erase, showOverlay } = props;
  const selected = masks.find((mask) => mask.id === selectedId) ?? null;
  const update = (patch: Partial<Mask>) => selected && props.onChange(masks.map((mask) => mask.id === selected.id ? { ...mask, ...patch } as Mask : mask));
  const add = (kind: Mask['kind']) => {
    const mask = createMask(kind, crypto.randomUUID());
    props.onChange([...masks, mask]);
    props.onSelect(mask.id);
    props.onShowOverlay(true);
  };
  const chip = 'min-h-11 rounded-md border border-white/10 px-2 text-xs text-zinc-200 hover:bg-white/8 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sky-400 md:min-h-9';
  return (
    <div className="space-y-2 px-1 pb-2">
      <p className="text-xs text-zinc-400">Masks adjust part of the photo. Add one, drag its handles on the photo, then move its sliders.</p>
      <div className="grid grid-cols-3 gap-1">
        {(['linear', 'radial', 'brush'] as const).map((kind) => (
          <button key={kind} type="button" disabled={disabled || masks.length >= MAX_MASKS} className={`${chip} inline-flex items-center justify-center gap-1`} onClick={() => add(kind)}>
            {kind === 'brush' ? <Paintbrush className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            {KIND_NAMES[kind]}
          </button>
        ))}
      </div>
      {masks.length > 0 && (
        <ul className="space-y-1" aria-label="Masks">
          {masks.map((mask) => (
            <li key={mask.id}>
              <button type="button" aria-pressed={mask.id === selectedId} className={`${chip} w-full text-left aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15`}
                onClick={() => props.onSelect(mask.id === selectedId ? null : mask.id)}>
                {maskName(masks, mask)}{mask.id === selectedId ? ' (editing)' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="space-y-1 rounded-md border border-white/10 p-2">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={showOverlay} onChange={(event) => props.onShowOverlay(event.target.checked)} /> Show mask on photo
          </label>
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.invert} onChange={(event) => update({ invert: event.target.checked })} /> Invert (affect everything else)
          </label>
          {selected.kind !== 'brush' && (
            <label className="block text-xs text-zinc-300">
              <span className="flex justify-between"><span>Edge softness</span><output className="tabular-nums text-zinc-400">{Math.round(selected.feather * 100)}</output></span>
              <input type="range" min={0} max={1} step={0.01} value={selected.feather} aria-label="Edge softness"
                onChange={(event) => update({ feather: event.target.valueAsNumber })} className="block min-h-9 w-full accent-sky-300 md:min-h-7" />
            </label>
          )}
          {selected.kind === 'brush' && (
            <div className="space-y-1">
              <label className="block text-xs text-zinc-300">
                <span className="flex justify-between"><span>Brush size</span><output className="tabular-nums text-zinc-400">{Math.round(brushRadius * 200)}</output></span>
                <input type="range" min={0.01} max={0.2} step={0.005} value={brushRadius} aria-label="Brush size"
                  onChange={(event) => props.onBrushRadius(event.target.valueAsNumber)} className="block min-h-9 w-full accent-sky-300 md:min-h-7" />
              </label>
              <div className="flex gap-1">
                <button type="button" aria-pressed={!erase} className={`${chip} flex-1 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15`} onClick={() => props.onErase(false)}>
                  <Paintbrush className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Paint
                </button>
                <button type="button" aria-pressed={erase} className={`${chip} flex-1 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15`} onClick={() => props.onErase(true)}>
                  <Eraser className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Erase
                </button>
                <button type="button" className={chip} onClick={() => update({ strokes: [] })} disabled={selected.kind === 'brush' && !selected.strokes.length}>Clear</button>
              </div>
              <p className="text-xs text-zinc-500">Painting needs a pointer or finger. Gradient and oval masks can be set with the keyboard.</p>
            </div>
          )}
          <div className="space-y-1 pt-1">
            {LOCAL_KEYS.map((key) => (
              <label key={key} className="block text-xs text-zinc-300">
                <span className="flex justify-between"><span>{LABELS[key]}</span><output className="tabular-nums text-zinc-400">{Math.round((selected.edit[key] ?? 0) * 50)}</output></span>
                <input type="range" min={-2} max={2} step={0.05} value={selected.edit[key] ?? 0} aria-label={`${LABELS[key]} for this mask`}
                  onChange={(event) => update({ edit: { ...selected.edit, [key]: event.target.valueAsNumber } })}
                  onDoubleClick={() => update({ edit: { ...selected.edit, [key]: 0 } })}
                  className="block min-h-9 w-full accent-sky-300 md:min-h-7" />
              </label>
            ))}
          </div>
          <button type="button" className={`${chip} inline-flex w-full items-center justify-center gap-1`}
            onClick={() => { props.onChange(masks.filter((mask) => mask.id !== selected.id)); props.onSelect(null); }}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete this mask
          </button>
        </div>
      )}
    </div>
  );
}
