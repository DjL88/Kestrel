import { useState } from 'react';
import { BUILT_IN_PRESETS, type Preset } from '../core/presets';
import { loadPresets } from '../providers/browserPresets';
import { previewKeeperLook } from '../core/batchLooks';
import type { PhotoFrame } from '../core/types';
import type { PhotoEdit } from '../core/photoEdits';
import { ConfirmDialog } from './ConfirmDialog';

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
    <ConfirmDialog title="Apply a look to keepers" confirmLabel={`Apply to ${summary.eligible} ${summary.eligible === 1 ? 'photo' : 'photos'}`}
      cancelLabel="Cancel" onCancel={onClose} confirmDisabled={!look || summary.eligible === 0}
      onConfirm={() => { if (!look) return; onApply(look.edit, includeEdited); onClose(); }}>
      <p>Give your keepers a consistent starting look. This changes sliders, not original files. You can undo each photo's edits.</p>
      <label className="block text-sm">
        Look
        <select aria-label="Look for keepers" value={selected} onChange={(event) => setSelected(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-md border border-white/20 bg-kestrel-panel px-3 text-zinc-100">
          {looks.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={includeEdited} onChange={(event) => setIncludeEdited(event.target.checked)} />
        Include photos I've already edited
      </label>
      <p role="status" className="text-sm">{summary.eligible} of {summary.total} keepers will receive this look.
        {summary.skipped > 0 && ` ${summary.skipped} already-edited photos will be left alone.`}</p>
      {includeEdited && <p className="text-xs">Existing global sliders will be replaced; local masks and crops stay unchanged. Each photo retains its edit history.</p>}
    </ConfirmDialog>
  );
}
