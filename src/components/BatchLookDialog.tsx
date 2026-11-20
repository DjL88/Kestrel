import { useState } from 'react';
import { BUILT_IN_PRESETS, type Preset } from '../core/presets';
import { loadPresets } from '../providers/browserPresets';
import { previewKeeperLook } from '../core/batchLooks';
import type { PhotoFrame } from '../core/types';
import type { PhotoEdit } from '../core/photoEdits';
import { ConfirmDialog } from './ConfirmDialog';
import { exportText } from '../i18n/areas/export';

const t = exportText.looks;

interface Props {
  frames: PhotoFrame[];
  onApply: (edit: PhotoEdit, includeEdited: boolean) => void;
  onClose: () => void;
}

/** No AI, no preview download and no silent changes: the photographer chooses a look and sees its scope. */
export function BatchLookDialog({ frames, onApply, onClose }: Props) {
  const [custom] = useState<Preset[]>(loadPresets);
  const looks = [...BUILT_IN_PRESETS, ...custom];
  const [selected, setSelected] = useState(looks[0]?.id ?? '');
  const [includeEdited, setIncludeEdited] = useState(false);
  const look = looks.find((entry) => entry.id === selected);
  const summary = previewKeeperLook(frames, includeEdited);
  return (
    <ConfirmDialog title={t.keepersTitle} confirmLabel={t.keepersApply(summary.eligible)}
      cancelLabel={t.cancel} onCancel={onClose} confirmDisabled={!look || summary.eligible === 0}
      onConfirm={() => { if (!look) return; onApply(look.edit, includeEdited); onClose(); }}>
      <p>{t.keepersIntro}</p>
      <label className="block text-sm">
        {t.recipe}
        <select aria-label={t.keepersRecipe} value={selected} onChange={(event) => setSelected(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-md border border-white/20 bg-kestrel-panel px-3 text-zinc-100">
          {looks.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={includeEdited} onChange={(event) => setIncludeEdited(event.target.checked)} />
        {t.includeEdited}
      </label>
      <p role="status" className="text-sm">{t.keepersWillReceive(summary.eligible, summary.total)}
        {summary.skipped > 0 && ` ${t.keepersLeftAlone(summary.skipped)}`}</p>
      {includeEdited && <p className="text-xs">{t.keepersReplaced}</p>}
    </ConfirmDialog>
  );
}
