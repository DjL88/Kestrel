import type { FeatureKey, PanelId } from '../ui/contract';

type Plan = Partial<Record<FeatureKey, 'basic' | 'pro'>>;
type Access = Partial<Record<FeatureKey, boolean>>;

/** Pro features this account cannot use right now. Empty for an account that has them all (a Pro account never sees the setting). */
export function lockedProFeatures(plan: Plan, access: Access): FeatureKey[] {
  return (Object.keys(plan) as FeatureKey[]).filter((key) => plan[key] === 'pro' && access[key] !== true);
}

/** Whether the "Hide Pro features" choice is offered: only while something Pro is locked, i.e. on a Basic account. */
export const canHidePro = (plan: Plan, access: Access): boolean => lockedProFeatures(plan, access).length > 0;

/** The features to leave out of the interface entirely: the locked Pro ones, and only when the person asked. */
export const hiddenProFeatures = (plan: Plan, access: Access, hide: boolean): FeatureKey[] => (hide ? lockedProFeatures(plan, access) : []);

/** The Pro features a tool is made of. A tool whose every feature is hidden has nothing left to show, so it leaves the tool rail
 * (and the mobile More sheet) entirely instead of being greyed out. A tool with any other content stays. */
export const PANEL_PRO_FEATURES: Partial<Record<PanelId, readonly FeatureKey[]>> = {
  overlays: ['overlayText', 'watermarkCustom'],
};

export function panelsHiddenByPro(hidden: readonly FeatureKey[]): PanelId[] {
  return (Object.entries(PANEL_PRO_FEATURES) as Array<[PanelId, readonly FeatureKey[]]>)
    .filter(([, features]) => features.length > 0 && features.every((feature) => hidden.includes(feature)))
    .map(([panel]) => panel);
}
