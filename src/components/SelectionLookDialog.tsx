import { useState } from 'react';
import { BUILT_IN_PRESETS, type Preset } from '../core/presets';
import { loadPresets } from '../providers/browserPresets';
import { previewSelectedLook } from '../core/selectedLooks';
import type { PhotoFrame } from '../core/types';
import type { PhotoEdit } from '../core/photoEdits';
import { ConfirmDialog } from './ConfirmDialog';

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
  return <ConfirmDialog title="Apply recipe to selected photos" confirmLabel={`Apply to ${count.eligible} photos`}
    confirmDisabled={!selectedLook || count.eligible === 0} cancelLabel="Cancel" onCancel={onClose}
    onConfirm={() => { if (selectedLook) onApply(selectedLook.edit, includeEdited); onClose(); }}>
    <p>Apply a consistent recipe to your chosen photos. This updates editable sliders and each photo's undo history, not the originals.</p>
    <label className="block text-sm">Recipe
      <select aria-label="Recipe for selected photos" className="mt-1 min-h-11 w-full rounded-md border border-white/20 bg-kestrel-panel px-3 text-zinc-100"
        value={lookId} onChange={(event) => setLookId(event.target.value)}>
        {looks.map((look) => <option key={look.id} value={look.id}>{look.name}</option>)}
      </select>
    </label>
    <label className="flex min-h-11 items-center gap-2">
      <input type="checkbox" checked={includeEdited} onChange={(event) => setIncludeEdited(event.target.checked)} />
      Include photos I've already edited
    </label>
    <p role="status">{count.eligible} of {count.total} selected photos will change.
      {count.skipped > 0 && ` ${count.skipped} existing edits are protected.`}</p>
    {includeEdited && <p className="text-xs">Previous global adjustments will be replaced, while each photo keeps its masks and crop. Undo remains available.</p>}
  </ConfirmDialog>;
}
