import type { PictureProvenance } from '../../../core/pictureSource';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';

/** The words for a RAW's picture: what it is, the detail, and a short form for small tiles. */
export function pictureSourceWords(picture: PictureProvenance): { label: string; short: string; detail: string } {
  const words = STRINGS.pictureSource;
  const codec = picture.codec === 'nikon-he' ? words.he : picture.codec === 'nikon-he-star' ? words.heStar : '';
  const codecShort = picture.codec === 'nikon-he' ? 'HE' : picture.codec === 'nikon-he-star' ? 'HE*' : '';
  if (picture.kind === 'camera') {
    return {
      label: codec ? `${words.camera} (${codec})` : words.camera,
      short: words.cameraShort,
      detail: words.cameraDetail,
    };
  }
  return {
    label: codec ? `${words.raw} (${codec})` : words.raw,
    short: codecShort ? `${words.rawShort} ${codecShort}` : words.rawShort,
    detail: picture.size === 'full' ? words.rawFullDetail : words.rawScreenDetail,
  };
}

/**
 * Says which picture of a RAW is on screen, in words and an icon (never colour alone): the camera's embedded preview, or
 * InFlight's develop from the sensor data, Nikon HE/HE* named when the file's headers said so.
 */
export default function PictureSourceBadge({ picture, compact = false, className = '' }: { picture?: PictureProvenance; compact?: boolean; className?: string }) {
  if (!picture) return null;
  const { label, short, detail } = pictureSourceWords(picture);
  return (
    <span
      data-testid="picture-source"
      data-picture-source={picture.kind === 'camera' ? 'camera-preview' : `raw-${picture.size ?? 'screen'}`}
      title={`${label}. ${detail}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm border px-1 font-sans font-semibold ${
        picture.kind === 'camera'
          ? 'border-dashed border-[var(--border-default)] text-[var(--text-secondary)]'
          : 'border-solid border-[var(--border-default)] text-[var(--text-primary)]'
      } ${className}`}
    >
      <BrandIcon name={picture.kind === 'camera' ? 'image' : 'camera-settings'} size={compact ? 10 : 12} />
      <span aria-hidden={compact ? 'true' : undefined}>{compact ? short : label}</span>
      {compact && <span className="sr-only">{label}</span>}
    </span>
  );
}
