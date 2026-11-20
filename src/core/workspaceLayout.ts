/** One dimension-based Library/Review/Edit layout contract.
 * No user-agent sniffing: small landscape tablets and unfolded phones may use
 * the same two-column workspace as desktop when the CSS viewport can fit it.
 * Photo Info still has its own more conservative threshold.
 * Keep this query identical to the Tailwind 'workspace' custom variant.
 */
export const WIDE_WORKSPACE_QUERY =
  '((min-width: 800px) and (min-height: 550px)) or ((min-width: 840px) and (min-height: 440px) and (max-height: 549px))';

export function canUseWideWorkspace(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  return (width >= 800 && height >= 550) || (width >= 840 && height >= 440 && height < 550);
}
