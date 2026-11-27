import React from 'react';
import { clipChips } from '../../../core/clippingMap';
import { colourBadge, type ColourBadgeShape } from '../../../core/colourBadge';
import type { OnImageAdvice } from '../../../core/onImageAdvice';
import { describeColourSense } from '../../engineClient/colourWords';
import { STRINGS } from '../strings';
import type { AdviceFocus } from '../utils/adviceFocus';

/**
 * Read-only advice drawn on and under the canvas (nothing here edits the photo):
 *  - `AdviceLayer`, inside the picture's own SVG next to the mask outline: clipped highlights and shadows as hatching (a
 *    pattern, never a colour, so it reads for everyone) and a ring at the focus point with a word for what it is;
 *  - `AdviceReadout`, in the status line under the picture (Dave, 27 Nov: nothing should cover the image): the corner
 *    chips ("Highlights clipped 3%", each with a swatch of its own hatching) and the Colour Sense badge, always shown,
 *    in words and a shape that differs for every verdict;
 *  - `AdviceToggle`, the canvas toolbar switch (a button, so it is keyboard operable).
 * White on a dark halo reads on any photograph. The measuring is not here: the engine measures each photo's advice once
 * its edit settles, at preview size (src/v2/engineClient/adviceMeasure.ts), so drawing never touches pixels.
 */

const t = () => STRINGS.onImageAdvice;
const HATCH_PERIOD = 9;

interface LayerProps {
  /** The displayed picture's own pixel size; this layer is drawn inside an SVG whose viewBox is that size. */
  picture: { width: number; height: number };
  advice: OnImageAdvice;
  focus: AdviceFocus | null;
}

const FOCUS_WORD: Record<AdviceFocus['kind'], () => string> = {
  camera: () => t().focusCamera, eye: () => t().focusEye, eyeMaybe: () => t().focusEyeMaybe, subject: () => t().focusSubject,
};

export default function AdviceLayer({ picture, advice, focus }: LayerProps) {
  const { width, height } = picture;
  const patternId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const group = React.useRef<SVGGElement | null>(null);
  // Screen pixels per picture pixel, so stripes and the ring keep their on-screen size at every zoom.
  const [screenScale, setScreenScale] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const ctm = group.current?.ownerSVGElement?.getScreenCTM();
    const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 0;
    if (scale > 0 && (!screenScale || Math.abs(scale - screenScale) / screenScale > 0.05)) setScreenScale(scale);
  });
  const unit = screenScale ? 1 / screenScale : Math.max(width, height) / 600;
  const clipping = advice.clipping;
  const period = HATCH_PERIOD * unit;
  const stripes = (rotate: number, name: string) => (
    <pattern id={`${patternId}-${name}`} patternUnits="userSpaceOnUse" width={period} height={period} patternTransform={`rotate(${rotate})`}>
      <line x1={0} y1={0} x2={0} y2={period} stroke="rgba(0,0,0,0.7)" strokeWidth={4 * unit} />
      <line x1={0} y1={0} x2={0} y2={period} stroke="#ffffff" strokeWidth={1.5 * unit} />
    </pattern>
  );
  const regions = (list: NonNullable<typeof clipping>['highlights'], name: 'hi' | 'lo', label: string) => list.map((region, index) => (
    <rect key={`${name}${index}`} data-testid={`advice-clip-${name}`} role="img" aria-label={label}
      x={region.x * width} y={region.y * height} width={region.width * width} height={region.height * height} fill={`url(#${patternId}-${name})`} />
  ));
  const ringAt = focus ? { x: focus.x * width, y: focus.y * height } : null;
  const word = focus ? FOCUS_WORD[focus.kind]() : '';

  return (
    <g ref={group} data-testid="advice-marks" role="group" aria-label={t().layerLabel} style={{ pointerEvents: 'none' }}>
      <defs>{stripes(45, 'hi')}{stripes(-45, 'lo')}</defs>
      {clipping && regions(clipping.highlights, 'hi', t().highlightsWhere)}
      {clipping && regions(clipping.shadows, 'lo', t().shadowsWhere)}
      {ringAt && focus && (
        <g data-testid="advice-focus" data-kind={focus.kind} role="img" aria-label={word}>
          <title>{word}</title>
          <circle cx={ringAt.x} cy={ringAt.y} r={16 * unit} fill="none" stroke="rgba(0,0,0,0.7)" strokeWidth={4} vectorEffect="non-scaling-stroke" />
          <circle cx={ringAt.x} cy={ringAt.y} r={16 * unit} fill="none" stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <circle cx={ringAt.x} cy={ringAt.y} r={2 * unit} fill="#ffffff" stroke="rgba(0,0,0,0.7)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <text x={ringAt.x} y={ringAt.y + 30 * unit} textAnchor="middle" fontSize={11 * unit} fontWeight={600} fill="#ffffff"
            stroke="rgba(0,0,0,0.75)" strokeWidth={3 * unit} paintOrder="stroke" strokeLinejoin="round">{word}</text>
        </g>
      )}
    </g>
  );
}

/** One small shape per verdict, so the verdict is never carried by colour: tick in a circle, diamond, triangle, open circle. */
function BadgeShape({ shape }: { shape: ColourBadgeShape }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" data-shape={shape} className="shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      {shape === 'tick' && <><circle cx="6" cy="6" r="5" /><path d="M3.6 6.2 5.4 8 8.5 4.2" /></>}
      {shape === 'diamond' && <path d="M6 1 11 6 6 11 1 6Z" fill="currentColor" fillOpacity="0.25" />}
      {shape === 'triangle' && <><path d="M6 1.2 11 10.5H1Z" /><path d="M6 4.6v2.7M6 8.9v.2" /></>}
      {shape === 'ring' && <circle cx="6" cy="6" r="4.6" strokeDasharray="2 2" />}
    </svg>
  );
}

/** A little square of the same stripes the picture shows, so the chip is tied to its hatching by pattern, not colour. */
function Swatch({ direction }: { direction: 'highlights' | 'shadows' }) {
  const id = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" className="shrink-0">
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform={`rotate(${direction === 'highlights' ? 45 : -45})`}>
          <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="1.6" />
        </pattern>
      </defs>
      <rect x="0.75" y="0.75" width="12.5" height="10.5" fill={`url(#${id})`} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function AdviceReadout({ advice, cvdGuidance }: { advice: OnImageAdvice; cvdGuidance: boolean }) {
  const words = t();
  const chips = clipChips(advice.clipping);
  const badge = colourBadge(advice.colour);
  const verdict = { kept: words.colourKept, adjusted: words.colourAdjusted, review: words.colourReview, unsure: words.colourUnsure }[badge.kind];
  // The measured detail ("Subject colour kept: blue", what moved) is the same sentence the suggestions use. It is the
  // tooltip for everyone and said out loud beside the verdict when Colour-vision support is on.
  const detail = describeColourSense(advice.colour)?.text;
  return (
    <span data-testid="advice-readout" role="group" aria-label={words.layerLabel} className="flex shrink-0 items-center gap-3 text-[var(--text-primary)]">
      {chips.map((chip) => (
        <span key={chip.kind} data-testid="advice-chip" data-kind={chip.kind} className="inline-flex items-center gap-1.5">
          <Swatch direction={chip.kind} />
          <span>{chip.kind === 'highlights' ? words.highlightsClipped(chip.percent) : words.shadowsClipped(chip.percent)}</span>
        </span>
      ))}
      <span data-testid="advice-colour" data-kind={badge.kind} data-shape={badge.shape} title={detail || undefined} className="inline-flex items-center gap-1.5">
        <BadgeShape shape={badge.shape} />
        <span className="sr-only">{words.colourLabel}: </span>
        <span className="font-semibold">{verdict}</span>
        {cvdGuidance && detail && <span data-testid="advice-colour-detail" className="text-[var(--text-secondary)]">{detail}</span>}
      </span>
    </span>
  );
}

export function AdviceToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" data-testid="advice-toggle" aria-pressed={shown} title={t().toggleTitle} aria-label={t().toggle} onClick={onToggle}
      className="inline-flex h-8 min-w-8 items-center justify-center rounded-[var(--radius-sm)] px-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] aria-pressed:text-[var(--brand-accent)]">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
        <path d="M5 13.5 10 2.5M9 13.5l5-9M1.5 9.5l4-7" />
      </svg>
    </button>
  );
}
