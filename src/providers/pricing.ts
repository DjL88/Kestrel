/**
 * The prices the app shows, from the pricing matrix the owner edits in Admin (served by the control plane at
 * /v1/pricing; src/core/pricingMatrix.ts). Fetched only when this build knows a control plane address, at most every
 * six hours, with nothing about the person in the request. Offline or on any failure the app shows the last copy it
 * read, or the compiled starting prices. Paddle's checkout always shows the final amount, with tax, before paying.
 */
import { parseControlPlaneUrl } from '../core/licenceOnline';
import { guessRegion } from '../core/regionGuess';
import { DEFAULT_PRICING, publicPricing, readPublicPricing, type PublicPricing } from '../core/pricingMatrix';

export const PRICING_KEY = 'kestrel.pricing.v1';
export const PRICING_REFRESH_MS = 6 * 60 * 60 * 1000;

export interface PricingSourceOptions {
  baseUrl: string | null;
  storage: { getItem(name: string): string | null; setItem(name: string, value: string): void };
  fetch: typeof fetch;
  now: () => number;
}

export function pricingSource(o: PricingSourceOptions) {
  const stored = (): { atMs: number; pricing: PublicPricing } | null => {
    try {
      const raw = JSON.parse(o.storage.getItem(PRICING_KEY) ?? 'null') as { atMs?: unknown; pricing?: unknown } | null;
      const pricing = raw ? readPublicPricing(raw.pricing) : null;
      return pricing && typeof raw!.atMs === 'number' ? { atMs: raw!.atMs, pricing } : null;
    } catch { return null; }
  };
  return {
    /** What to show right now, without waiting for the network. */
    current: (): PublicPricing => stored()?.pricing ?? publicPricing(DEFAULT_PRICING),
    /** Refreshes when due; returns the prices to show. Never throws. */
    async refresh(): Promise<PublicPricing> {
      const last = stored();
      if (!o.baseUrl || (last && o.now() - last.atMs < PRICING_REFRESH_MS)) return last?.pricing ?? publicPricing(DEFAULT_PRICING);
      try {
        const response = await o.fetch(`${o.baseUrl}/v1/pricing`, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8_000) });
        const pricing = response.ok ? readPublicPricing(await response.json()) : null;
        if (pricing) {
          try { o.storage.setItem(PRICING_KEY, JSON.stringify({ atMs: o.now(), pricing })); } catch { /* storage full or blocked */ }
          return pricing;
        }
      } catch { /* offline: keep what we have */ }
      return last?.pricing ?? publicPricing(DEFAULT_PRICING);
    },
  };
}

const memory = new Map<string, string>();
const browserStorage = {
  getItem: (name: string) => { try { return localStorage.getItem(name); } catch { return memory.get(name) ?? null; } },
  setItem: (name: string, value: string) => { try { localStorage.setItem(name, value); } catch { memory.set(name, value); } },
};

/** The app's one source of prices. */
export const appPricing = pricingSource({
  baseUrl: parseControlPlaneUrl(import.meta.env?.VITE_KESTREL_CONTROL_PLANE_URL),
  storage: browserStorage,
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
});

/** The person's country for showing prices: the computer's time zone first, else the language (see core/regionGuess). */
export function browserRegion(): string | null {
  if (typeof navigator === 'undefined') return null;
  let zone: string | undefined;
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* none */ }
  return guessRegion(zone, navigator.languages?.length ? navigator.languages : [navigator.language]);
}
