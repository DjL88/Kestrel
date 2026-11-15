import { newId } from '../core/ids';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { BUILT_IN_PRESETS, addPreset, removePreset, type Preset } from '../core/presets';
import { loadPresets, savePresets } from '../providers/browserPresets';
import { isNeutralEdit, type PhotoEdit } from '../core/photoEdits';

interface Props {
  edit: PhotoEdit;
  disabled: boolean;
  onApply: (edit: PhotoEdit) => void;
}

export function PresetPanel({ edit, disabled, onApply }: Props) {
  const [custom, setCustom] = useState<Preset[]>(loadPresets);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const chip = 'min-h-11 rounded-md border border-white/10 px-2 text-left text-xs text-zinc-200 hover:bg-white/8 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sky-400 desk:min-h-9';

  function update(next: Preset[], message: string) {
    setCustom(next);
    setNotice(savePresets(next) ? message : 'Could not save on this device. The preset works until you leave.');
  }

  return (
    <div className="space-y-2 px-1 pb-2">
      <p className="text-xs text-zinc-400">Presets set the sliders. You can still adjust them, and undo restores the previous look.</p>
      <div className="grid grid-cols-2 gap-1">
        {[...BUILT_IN_PRESETS, ...custom].map((preset) => (
          <div key={preset.id} className="flex min-w-0 gap-1">
            <button type="button" disabled={disabled} className={`${chip} min-w-0 flex-1 truncate`}
              onClick={() => { onApply(preset.edit); setNotice(`Applied ${preset.name}`); }}>{preset.name}</button>
            {!preset.builtIn && (
              <button type="button" aria-label={`Delete preset ${preset.name}`} title={`Delete preset ${preset.name}`} className={`${chip} px-2`}
                onClick={() => update(removePreset(custom, preset.id), `Deleted ${preset.name}`)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-500">Style presets are approximate looks. They are not Nikon colour science.</p>
      <form className="flex gap-1" onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || isNeutralEdit(edit)) return;
        update(addPreset(custom, name, edit, newId()), `Saved ${name.trim()}`);
        setName('');
      }}>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="Name this look"
          aria-label="Preset name" className="min-h-11 min-w-0 flex-1 rounded-md border border-white/15 bg-black/20 px-2 text-base desk:min-h-9 md:text-sm" />
        <button type="submit" disabled={!name.trim() || isNeutralEdit(edit)} className={`${chip} shrink-0 font-semibold`}>Save look</button>
      </form>
      <p role="status" className="min-h-4 text-xs text-zinc-300">{notice}</p>
    </div>
  );
}
