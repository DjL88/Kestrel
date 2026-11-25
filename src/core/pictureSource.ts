/**
 * Which picture of a photo is on screen: the camera's own embedded JPEG, or a picture InFlight developed from the RAW's
 * sensor data (screen-sized in the background, or full size on demand). The provider records this when it makes each
 * preview address, so a label reads a fact, never an assumption. Non-RAW files show their own pixels and need no label.
 */
export type PictureSource = 'camera-preview' | 'raw-review' | 'raw-full' | 'original';

/** How a RAW's sensor data was compressed, as read from the file's own headers ('other' = anything not Nikon HE/HE*). */
export type RawCodec = 'nikon-he' | 'nikon-he-star' | 'other';

export const RAW_CODECS: readonly RawCodec[] = ['nikon-he', 'nikon-he-star', 'other'];

export function isRawCodec(value: unknown): value is RawCodec {
  return typeof value === 'string' && (RAW_CODECS as readonly string[]).includes(value);
}

/** What a label needs to say. Absent when there is nothing to say (a JPEG, or no picture yet). */
export interface PictureProvenance {
  /** 'camera' = the camera's embedded preview; 'raw' = developed by InFlight from the sensor data. */
  kind: 'camera' | 'raw';
  /** For 'raw': screen-sized (background develop) or the full sensor size. */
  size?: 'screen' | 'full';
  /** Named only when the file's headers said so. Unknown stays unnamed. */
  codec?: 'nikon-he' | 'nikon-he-star';
}

export function pictureProvenance(source: PictureSource | undefined, codec: RawCodec | undefined): PictureProvenance | undefined {
  if (!source || source === 'original') return undefined;
  const named = codec === 'nikon-he' || codec === 'nikon-he-star' ? { codec } : {};
  if (source === 'camera-preview') return { kind: 'camera', ...named };
  return { kind: 'raw', size: source === 'raw-full' ? 'full' : 'screen', ...named };
}
