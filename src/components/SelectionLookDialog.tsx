import { useState } from 'react';
import { BUILT_IN_PRESETS, type Preset } from '../core/presets';
import { loadPresets } from '../providers/browserPresets';
import { previewSelectedLook } from '../core/selectedLooks';
import type { PhotoFrame } from '../core/types';
import type { PhotoEdit } from '../core/photoEdits';
import { ConfirmDialog } from './ConfirmDialog';
import { exportText } from '../i18n/areas/export';

const t = exportText.looks;

interface Props {
  frames: PhotoFrame[];
  ids: ReadonlySet<string>;
  onApply: (edit: PhotoEdit, includeEdited: boolean) => void;
  onClose: () => void;
}

/** Works from Library or filmstrip, with no extra controls in the main editor. */
export function SelectionLookDialog({ frames, ids, onApply, onClose }: Props) {
  const [saved] = useState<Preset[]>(loadPresets);
  const looks = [...BUILT_IN_PRESETS, ...saved];
  const [lookId, setLookId] = useState(looks[0]?.id ?? '');
  const [includeEdited, setIncludeEdited] = useState(false);
  const selectedLook = looks.find((look) => look.id === lookId);
  const count = previewSelectedLook(frames, ids, includeEdited);
  return <ConfirmDialog title={t.selectionTitle} confirmLabel={t.selectionApply(count.eligible)}
    confirmDisabled={!selectedLook || count.eligible === 0} cancelLabel={t.cancel} onCancel={onClose}
    onConfirm={() => { if (selectedLook) onApply(selectedLook.edit, includeEdited); onClose(); }}>
    <p>{t.selectionIntro}</p>
    <label className="block text-sm">{t.recipe}
      <select aria-label={t.selectionRecipe} className="mt-1 min-h-11 w-full rounded-md border border-white/20 bg-kestrel-panel px-3 text-zinc-100"
        value={lookId} onChange={(event) => setLookId(event.target.value)}>
        {looks.map((look) => <option key={look.id} value={look.id}>{look.name}</option>)}
      </select>
    </label>
    <label className="flex min-h-11 items-center gap-2">
      <input type="checkbox" checked={includeEdited} onChange={(event) => setIncludeEdited(event.target.checked)} />
      {t.includeEdited}
    </label>
    <p role="status">{t.selectionWillChange(count.eligible, count.total)}
      {count.skipped > 0 && ` ${t.selectionProtected(count.skipped)}`}</p>
    {includeEdited && <p className="text-xs">{t.selectionReplaced}</p>}
  </ConfirmDialog>;
}
