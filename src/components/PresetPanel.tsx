import { newId } from '../core/ids';
import { useEffect, useRef, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { BUILT_IN_PRESETS, addPreset, matchesPresetEdit, removePreset, type Preset } from '../core/presets';
import { loadPresets, savePresets } from '../providers/browserPresets';
import { applyDetail, applyPhotoEdit, hasDetail, isNeutralEdit, type PhotoEdit } from '../core/photoEdits';

interface Props {
  edit: PhotoEdit;
  disabled: boolean;
  onApply: (edit: PhotoEdit) => void;
  previewSource?: ImageData | null;
}

/** Render one small comparison tile locally with the same adjustment maths as export. */
function LookPreview({ sample, preset }: { sample?: ImageData | null; preset: Preset }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !sample) return;
    target.width = sample.width;
    target.height = sample.height;
    const context = target.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    const pixels = new ImageData(new Uint8ClampedArray(sample.data), sample.width, sample.height);
    applyPhotoEdit(pixels.data, preset.edit);
    if (hasDetail(preset.edit)) applyDetail(pixels.data, sample.width, sample.height, preset.edit, Math.max(sample.width, sample.height));
    context.putImageData(pixels, 0, 0);
  }, [sample, preset]);
  return <canvas ref={canvas} aria-hidden="true" className="block aspect-[4/3] w-full rounded-t-md bg-black/30 object-cover" />;
}

export function PresetPanel({ edit, disabled, onApply, previewSource }: Props) {
  const [custom, setCustom] = useState<Preset[]>(loadPresets);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const chip = 'min-h-11 rounded-md border border-white/10 px-2 text-left text-xs text-zinc-200 hover:bg-white/8 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sky-400 desk:min-h-9';

  function update(next: Preset[], message: string) {
    setCustom(next);
    setNotice(savePresets(next) ? message : 'Could not save on this device. The recipe works until you leave.');
  }

  return (
    <div className="space-y-2 px-1 pb-2">
      <p className="text-xs text-zinc-400">Tap a recipe to update the sliders. Undo takes you back.</p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Photo recipes gallery">
        {[...BUILT_IN_PRESETS, ...custom].map((preset) => {
          const selected = matchesPresetEdit(edit, preset.edit);
          return (
            <div key={preset.id} className="relative min-w-0">
              <button type="button" disabled={disabled} aria-label={preset.name} aria-pressed={selected}
                className={`w-full overflow-hidden rounded-lg border text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-50 ${selected ? 'border-sky-200 ring-2 ring-sky-200' : 'border-white/15 hover:border-white/50'}`}
                onClick={() => { onApply(preset.edit); setNotice(`Applied ${preset.name}`); }}>
                <LookPreview sample={previewSource} preset={preset} />
                <span className="flex min-h-8 items-center justify-center gap-1 px-1 py-1 text-center text-[10px] leading-tight text-zinc-200 sm:text-[11px]">
                  {selected && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
                  <span className="truncate">{preset.name}</span>
                </span>
                {selected && <span className="sr-only">Selected</span>}
              </button>
              {!preset.builtIn && <button type="button" aria-label={`Delete recipe ${preset.name}`} title={`Delete ${preset.name}`}
                className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-md bg-black/75 text-white hover:bg-black focus-visible:outline-2 focus-visible:outline-sky-300"
                onClick={() => update(removePreset(custom, preset.id), `Deleted ${preset.name}`)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>}
            </div>
          );
        })}
      </div>
      <form className="flex gap-1" onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || isNeutralEdit(edit)) return;
        update(addPreset(custom, name, edit, newId()), `Saved ${name.trim()}`);
        setName('');
      }}>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="Name this recipe"
          aria-label="Recipe name" className="min-h-11 min-w-0 flex-1 rounded-md border border-white/15 bg-black/20 px-2 text-base desk:min-h-9 md:text-sm" />
        <button type="submit" disabled={!name.trim() || isNeutralEdit(edit)} className={`${chip} shrink-0 font-semibold`}>Save recipe</button>
      </form>
      <p role="status" className="min-h-4 text-xs text-zinc-300">{notice}</p>
    </div>
  );
}
