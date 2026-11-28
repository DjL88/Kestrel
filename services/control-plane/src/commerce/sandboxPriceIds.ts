/**
 * Paddle prices that exist in the SANDBOX only (test cards, no money). Price IDs are environment-specific, so one of
 * these configured while KCP_PADDLE_ENVIRONMENT is "production" is a mistake that would send real buyers to a price
 * that cannot be charged: the server refuses to start instead. The live Pro Plus IDs are supplied by the owner in the
 * private tfvars (phase5_paddle_plus_price_id, phase5_paddle_plus_annual_price_id); none is stored in the repository.
 */
export const KNOWN_SANDBOX_PRICE_IDS: readonly string[] = [
  'pri_01m8gtexdr227trytz17d2x833', // Pro Plus, £9.99 a month (sandbox, 28 Nov 2026)
  'pri_01m8gtgejayw52twqkm38mn9qw', // Pro Plus, £99.99 a year (sandbox, 28 Nov 2026)
];

/** Throws when production is configured with a price ID known to be a sandbox one. */
export function assertNoSandboxPricesInProduction(environment: 'sandbox' | 'production', priceIds: Record<string, string | undefined>): void {
  if (environment !== 'production') return;
  const bad = Object.entries(priceIds).filter(([, id]) => id && KNOWN_SANDBOX_PRICE_IDS.includes(id)).map(([name]) => name);
  if (bad.length) throw new Error(`KCP_PADDLE_ENVIRONMENT is production but ${bad.join(', ')} is a sandbox Paddle price. Set the live price IDs.`);
}
