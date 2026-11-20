export interface ExportProfile {
  id: string;
  label: string;
  prefix: string;
  width: number;
  height: number;
  quality: number;
  format: 'png' | 'jpeg';
  maxBytes?: number;
  /** Only opt-in custom exports may enlarge pixels; never implies new detail. */
  allowUpscale?: boolean;
  /** Added to the file name, so different formats of one photo never share a name. */
  suffix?: string;
}

export const EXPORT_PROFILES: readonly ExportProfile[] = [
  { id: 'master', label: 'Full size · PNG', prefix: '', width: 0, height: 0, quality: 1, format: 'png' },
  { id: 'ig', label: 'Instagram', prefix: 'ig_', width: 1080, height: 1440, quality: 0.94, format: 'jpeg' },
  { id: 'fb', label: 'Facebook', prefix: 'fb_', width: 2048, height: 2048, quality: 0.94, format: 'jpeg' },
  { id: 'tok', label: 'TikTok', prefix: 'tok_', width: 1080, height: 1920, quality: 0.94, format: 'jpeg' },
  { id: 'x', label: 'X', prefix: 'x_', width: 2048, height: 2048, quality: 0.94, format: 'jpeg', maxBytes: 5_000_000 },
  { id: 'th', label: 'Threads', prefix: 'th_', width: 1440, height: 1920, quality: 0.94, format: 'jpeg' },
];

export function exportScale(width: number, height: number, profile: ExportProfile): number {
  const requested = Math.min((profile.width || width) / width, (profile.height || height) / height);
  return profile.allowUpscale === true ? requested : Math.min(1, requested);
}

export function exportFilename(name: string, profile: ExportProfile, isRaw: boolean) {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const stem = safe(name.replace(/\.[^.]+$/, ''));
  const extension = profile.format === 'png' ? 'png' : 'jpg';
  return `${safe(profile.prefix)}${stem}${isRaw ? '-preview' : ''}${profile.suffix ? `_${safe(profile.suffix)}` : ''}${profile.id === 'master' ? '-kestrel' : ''}.${extension}`;
}
