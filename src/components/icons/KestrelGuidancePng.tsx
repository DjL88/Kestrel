import type { ImgHTMLAttributes } from 'react';

/** Original approved transparent PNG marks, not traced or converted to SVG.
 * Keep the visible guidance-mode text alongside the icon. */
export type GuidanceMark = 'soar' | 'glide' | 'fly-solo';
export interface KestrelGuidancePngProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  mode: GuidanceMark;
  size?: number;
  /** Provide a spoken name only when the icon stands alone. Otherwise decorative. */
  label?: string;
}
const files: Record<GuidanceMark, string> = {
  soar: '/icons/guidance/soar.png',
  glide: '/icons/guidance/glide.png',
  'fly-solo': '/icons/guidance/fly-solo.png',
};
export function KestrelGuidancePng({ mode, size = 24, label, style, ...props }: KestrelGuidancePngProps) {
  return <img
    {...props}
    src={files[mode]}
    alt={label ?? ''}
    aria-hidden={label ? undefined : true}
    width={size}
    height={size}
    draggable={false}
    decoding="async"
    style={{ objectFit: 'contain', flexShrink: 0, ...style }}
  />;
}
