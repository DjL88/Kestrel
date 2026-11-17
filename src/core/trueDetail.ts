/** TrueDetail is a Kestrel Pro technology family, not a separate subscription.
 *
 * Release status is intentionally independent of the signed offline licence:
 * paid entitlement NEVER implies that unfinished imaging code exists.
 * Do not expose marketing copy as an available in-app processing action until
 * the implementation is verified and explicitly promoted to 'released'.
 */
export const TRUEDETAIL = {
  brand: 'Kestrel TrueDetail',
  tagline: 'See the detail. Keep it real.',
  tier: 'paid',
  capabilities: {
    raw: { name: 'TrueDetail RAW', status: 'research' },
    ai: { name: 'TrueDetail AI', status: 'research' },
    select: { name: 'TrueDetail Select', status: 'planned' },
    batch: { name: 'TrueDetail Batch', status: 'planned' },
  },
} as const;

export type TrueDetailCapability = keyof typeof TRUEDETAIL.capabilities;
export type TrueDetailStatus = 'planned' | 'research' | 'beta' | 'released';

export function trueDetailReleased(capability: TrueDetailCapability): boolean {
  return (TRUEDETAIL.capabilities[capability].status as TrueDetailStatus) === 'released';
}

/** A valid Paid licence is necessary but not sufficient to expose the action. */
export function trueDetailAvailable(capability: TrueDetailCapability, paidLicence: boolean): boolean {
  return paidLicence && trueDetailReleased(capability);
}

export function trueDetailCopy(capability: TrueDetailCapability): string {
  const item: { readonly name: string; readonly status: TrueDetailStatus } = TRUEDETAIL.capabilities[capability];
  return item.status === 'released' ? item.name : item.name + ' — in development';
}
