import { exportScale, type ExportProfile } from './exportProfiles';
import { cropRectangle } from './photoFraming';

export interface FocusPoint { x: number; y: number }
export type ExportFraming = 'fit' | 'focus' | 'border' | 'long';

export function planExportFraming(width: number, height: number, profile: ExportProfile, mode: ExportFraming,
  focus: FocusPoint = { x: 0.5, y: 0.5 }, longEdge?: number) {
  const hasBox = profile.width > 0 && profile.height > 0;
  const region = mode === 'focus' && hasBox
    ? cropRectangle(width, height, { ratio: profile.width / profile.height, x: focus.x, y: focus.y, turns: 0, straighten: 0 })
    : { x: 0, y: 0, width, height };
  const scale = mode === 'long'
    ? Math.min(1, (longEdge || Math.max(profile.width, profile.height) || Math.max(width, height)) / Math.max(width, height))
    : exportScale(region.width, region.height, profile);
  const border = mode === 'border' && hasBox ? { width: profile.width, height: profile.height } : undefined;
  return { region, scale, border };
}
