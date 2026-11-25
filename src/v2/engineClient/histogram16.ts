import { isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoEdit } from '../../core/photoEdits';
import type { PictureSource } from '../../core/pictureSource';
import type { PhotoFrame } from '../../core/types';
import type { PhotoHistogram } from '../ui/contract';
import { toPhotoHistogram16 } from './histogram';
import type { Raw16Working } from '../../providers/rawMaster16';
import type { PhotoFraming } from '../../core/photoFraming';

/**
 * The histogram is measured from the 16-bit RAW develop only when the picture on screen is InFlight's own develop of that
 * RAW (never the camera's embedded preview, which is a different picture), the original's fingerprint is known, and this
 * device can develop RAW. Otherwise the 8-bit measurement of the picture on screen stands, and says nothing more.
 */
export function histogram16Possible(frame: PhotoFrame, shownSource: PictureSource | undefined, decoderAvailable: boolean): boolean {
  return decoderAvailable && !frame.isDemo && isRawPreviewFile(frame.filename)
    && (shownSource === 'raw-review' || shownSource === 'raw-full')
    && /^[a-f0-9]{64}$/.test(frame.originalSha256 ?? '');
}

/** The few photos' 16-bit working copies kept while browsing, so an edit re-measures without developing the RAW again. */
export class Raw16WorkingCache {
  private readonly entries = new Map<string, Promise<Raw16Working | null>>();

  constructor(private readonly limit = 4) {}

  /** One develop per photo and fingerprint; a failed develop is remembered as null and not retried until the photo changes. */
  get(key: string, open: () => Promise<Raw16Working>): Promise<Raw16Working | null> {
    const known = this.entries.get(key);
    if (known) {
      this.entries.delete(key);
      this.entries.set(key, known);
      return known;
    }
    const pending = open().catch(() => null);
    this.entries.set(key, pending);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as string);
    return pending;
  }
}

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
