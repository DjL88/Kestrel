import { createContext, useContext } from 'react';
import type { FeatureKey } from '../contract';
import proDark from '../../../assets/brand/pro/inflight-pro-badge-dark.svg';
import proLight from '../../../assets/brand/pro/inflight-pro-badge-light.svg';
import { STRINGS } from '../strings';

/** Which plan each feature belongs to. Provided once by the app; a feature that is Basic shows no badge. */
export const FeaturePlanContext = createContext<Partial<Record<FeatureKey, 'basic' | 'pro'>>>({});

/**
 * The InFlight Pro badge, from the brand pack. It is the word "Pro" drawn in the badge, and it always comes with the
 * words "Part of InFlight Pro" for screen readers and as a tooltip, so it never relies on colour. Shows only for Pro
 * features. The dark or light version follows the V2 theme (see v2.css).
 */
export default function ProBadge({ feature, className = '' }: { feature: FeatureKey; className?: string }) {
  const plan = useContext(FeaturePlanContext)[feature];
  if (plan !== 'pro') return null;
  return (
    <span className={`inline-flex shrink-0 items-center ${className}`} title={STRINGS.pro.partOf}>
      <img src={proDark} alt="" aria-hidden="true" className="v2-pro-dark h-4 w-auto" draggable={false} />
      <img src={proLight} alt="" aria-hidden="true" className="v2-pro-light h-4 w-auto" draggable={false} />
      <span className="sr-only">{STRINGS.pro.partOf}</span>
    </span>
  );
}
