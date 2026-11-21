import type { SVGProps } from 'react';

/** Kestrel flight marks: 24px Lucide-compatible, currentColor, round 2px strokes.
 * Decorative when aria-label is absent; accessible when supplied.
 * Do not replace the primary K brand mark without verifying its source artwork.
 */
export type FlightIconProps = SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number };
type Shape = 'soar' | 'glide' | 'solo' | 'brand';
const paths: Record<Shape, string[]> = {
  soar: [
    'M12 13.5 8.5 11 3 5.5c1.4 5.5 4.6 8.5 9 9.5',
    'M12 13.5 15.5 11 21 5.5c-1.4 5.5-4.6 8.5-9 9.5',
    'M8.5 11 5.5 9.8M15.5 11l3-1.2',
    'M10.5 15.5 9 20l3-1.7 3 1.7-1.5-4.5',
    'M10.7 12.2q1.3-1.1 2.6 0M12.9 12.7l1 .2'
  ],
  glide: [
    'M2 12c3-1.6 6-2.5 9-1.2l2 1.2c3-1.8 6-2.5 9-1.5-3.5 2.5-6.6 3.8-9.4 3.8',
    'M11 10.8c-2 2.2-4.7 3.9-8 5.2l8.3-1.5',
    'M13 12c1.7 1.4 4.3 2.7 7 3.4',
    'M16.4 10.7q1.2-.9 2.4-.2l1.1.4',
    'M19.4 11l1.4.4'
  ],
  solo: [
    'M8 19c-2-3.3-2.5-7.5-1-10.9C8.4 4.6 11.7 3 14.8 4.7c2 1 3 2.6 3.1 4.6',
    'M17.9 9.3 21 11l-3.1 1.1c-.4 3.2-2 5.8-4.6 7.4',
    'M10 9.6c2.8.3 5.1 2.5 5.7 5.6l.5 3.6',
    'M11.5 18.7 9.7 21M14 19.2l1.5 2',
    'M5 21h13',
    'M15.1 7.6h.01'
  ],
  brand: [
    'M6 20V4M6 12l11-8M6 12l12 8',
    'M10 9.1c1.5-3.3 5.3-4.5 8.1-2.4l1.9 1.5-2.5.6',
    'M10 9.1c-.5 2.2.4 4.1 2.3 5.2',
    'M16 7.2h.01'
  ],
};
function FlightMark({ kind, size = 24, strokeWidth = 2, 'aria-label': label, ...props }: FlightIconProps & { kind: Shape }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} {...props}>
    {paths[kind].map((d, i) => <path key={i} d={d} />)}
  </svg>;
}
export function SoarIcon(props: FlightIconProps) { return <FlightMark kind="soar" {...props} />; }
export function GlideIcon(props: FlightIconProps) { return <FlightMark kind="glide" {...props} />; }
export function FlySoloIcon(props: FlightIconProps) { return <FlightMark kind="solo" {...props} />; }
/** Provisional motif only; the existing approved K logo remains authoritative. */
export function KestrelMotifIcon(props: FlightIconProps) { return <FlightMark kind="brand" {...props} />; }
