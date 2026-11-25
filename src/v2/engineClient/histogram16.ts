import type { PhotoEdit } from '../../core/photoEdits';
import type { PhotoHistogram } from '../ui/contract';
import { toPhotoHistogram16 } from './histogram';
import type { Raw16Working } from '../../providers/rawMaster16';
import type { PhotoFraming } from '../../core/photoFraming';

/** The 16-bit histogram of the kept copy with this edit, or null when an edit cannot be carried at 16 bits yet. */
export function histogramFromWorking(
  working: Raw16Working,
  edit: PhotoEdit,
  framing: PhotoFraming | undefined,
  render: (working: Raw16Working, edit: PhotoEdit, framing: PhotoFraming | undefined) => { data: Uint16Array } | null,
): PhotoHistogram | null {
  const edited = render(working, edit, framing);
  return edited ? toPhotoHistogram16(edited.data) : null;
}
