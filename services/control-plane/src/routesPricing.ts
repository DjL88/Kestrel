/**
 * The pricing matrix (src/core/pricingMatrix.ts): one table of every price, edited in Admin → Prices. The website and
 * the app read the offered prices at /v1/pricing; Paddle is kept in step from Admin, so checkout charges the same.
 */
import type { Route } from './http.ts';
import { ApiError } from './http.ts';
import type { AppContext } from './appContext.ts';
import {
  DEFAULT_PRICING, PRICE_ITEMS, computePrices, paddleDifferences, paddlePriceUpdate, parsePricingMatrix, publicPricing,
  type PaddleDifference, type PriceItem, type PricingMatrix,
} from '../../../src/core/pricingMatrix.ts';

const PUBLIC_CACHE_MS = 60_000;
const PLAN_OF: Record<PriceItem, 'monthly' | 'annual'> = { 'pro.monthly': 'monthly', 'pro.annual': 'annual' };

export function pricingRoutes(ctx: AppContext): Route[] {
  const { options, now, admin, adminDone } = ctx;
  // Without Firestore (local development and tests) the matrix lives in memory for the life of the process.
  let memory: PricingMatrix | null = null;
  const store = options.priceMatrix ?? { get: async () => memory, save: async (matrix: PricingMatrix) => { memory = matrix; } };
  let cached: { atMs: number; body: unknown } | null = null;

  const current = async () => {
    const stored = await store.get();
    return stored ? parsePricingMatrix(stored) : DEFAULT_PRICING;
  };

  /** Each Paddle price against the matrix. Null when Paddle is not set up on this server. */
  async function paddleCheck(matrix: PricingMatrix) {
    const paddle = options.paddlePrices;
    if (!paddle) return null;
    const items = await Promise.all(PRICE_ITEMS.map(async (item) => {
      const priceId = paddle.priceIds[PLAN_OF[item]];
      if (!priceId) return { item, priceId: null, differences: [] as PaddleDifference[], error: 'No Paddle price is set for this plan.' };
      try {
        return { item, priceId, differences: paddleDifferences(matrix, item, await paddle.get(priceId)), error: null };
      } catch (error) {
        return { item, priceId, differences: [] as PaddleDifference[], error: (error as Error).message };
      }
    }));
    return { inStep: items.every((row) => row.priceId && !row.error && row.differences.length === 0), items };
  }

  const view = async (matrix: PricingMatrix) => ({ matrix, prices: computePrices(matrix).all, paddle: await paddleCheck(matrix) });

  const parse = (body: unknown) => {
    try { return parsePricingMatrix(body); } catch (error) { throw new ApiError(400, 'BAD_PRICING', (error as Error).message); }
  };
  const bodyOf = (raw: string) => {
    try { return JSON.parse(raw); } catch { throw new ApiError(400, 'BAD_JSON', 'The request body is not JSON.'); }
  };

  return [
    {
      method: 'GET', path: '/v1/pricing', summary: 'Every price on offer from the pricing matrix, by plan and currency, and which countries pay in which currency (public)', auth: 'none',
      handler: async () => {
        if (!cached || now() - cached.atMs > PUBLIC_CACHE_MS) cached = { atMs: now(), body: publicPricing(await current()) };
        return { status: 200, body: cached.body, headers: { 'cache-control': 'public, max-age=300' } };
      },
    },
    {
      method: 'GET', path: '/v1/admin/pricing', summary: 'The pricing matrix, every computed price, and whether the Paddle prices match it', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'pricing.read');
        return adminDone(claims, 'pricing.read', '', await view(await current()));
      },
    },
    {
      method: 'POST', path: '/v1/admin/pricing/preview', summary: 'Compute the prices for an edited matrix without saving it', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'pricing.preview');
        const matrix = parse(bodyOf(req.rawBody));
        return adminDone(claims, 'pricing.preview', '', { matrix, prices: computePrices(matrix).all });
      },
    },
    {
      method: 'POST', path: '/v1/admin/pricing', summary: 'Save the pricing matrix. The website and app show it within minutes; Paddle changes only when you push it', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'pricing.save');
        const matrix = { ...parse(bodyOf(req.rawBody)), updatedAt: new Date(now()).toISOString(), updatedBy: claims.sub };
        await store.save(matrix);
        cached = null;
        const detail = PRICE_ITEMS.map((item) => item + '=' + matrix.base[item]).join(' ') + ' currencies=' + Object.keys(matrix.currencies).join(',');
        return adminDone(claims, 'pricing.save', detail, await view(matrix));
      },
    },
    {
      method: 'POST', path: '/v1/admin/pricing/rates', summary: 'Fetch today\'s ECB reference rates per £1 (not saved until the matrix is saved)', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'pricing.rates');
        if (!options.ecbRates) throw new ApiError(503, 'RATES_UNAVAILABLE', 'Exchange rates cannot be fetched on this server.');
        let rates;
        try { rates = await options.ecbRates(); } catch (error) { throw new ApiError(502, 'RATES_FAILED', (error as Error).message, true); }
        return adminDone(claims, 'pricing.rates', rates.date, { rates });
      },
    },
    {
      method: 'POST', path: '/v1/admin/pricing/paddle', summary: 'Set the Paddle prices to the saved matrix (GBP base and one country override per currency). Existing subscriptions keep their price', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'pricing.paddle.push');
        const paddle = options.paddlePrices;
        if (!paddle) throw new ApiError(503, 'PADDLE_UNAVAILABLE', 'Paddle is not set up on this server.');
        const matrix = await current();
        const pushed: string[] = [];
        for (const item of PRICE_ITEMS) {
          const priceId = paddle.priceIds[PLAN_OF[item]];
          if (!priceId) continue;
          try { await paddle.update(priceId, paddlePriceUpdate(matrix, item)); } catch (error) {
            throw new ApiError(502, 'PADDLE_UPDATE_FAILED', `Paddle refused the ${item} price: ${(error as Error).message}`, true);
          }
          pushed.push(item + '=' + priceId);
        }
        if (!pushed.length) throw new ApiError(503, 'PADDLE_UNAVAILABLE', 'No Paddle price is set for any plan.');
        return adminDone(claims, 'pricing.paddle.push', pushed.join(' '), await view(matrix));
      },
    },
  ];
}
