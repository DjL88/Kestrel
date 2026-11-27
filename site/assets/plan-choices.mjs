// Pure helpers for the plan choices on the home page: reading the public flags document the control plane serves at
// /v1/flags/public. No page access here, so the logic is unit-tested on its own (scripts/site/plan-choices.test.mjs).
//
// The flags only decide what the page SHOWS. Prices and discounts are decided by the server at checkout
// (services/control-plane/src/commerce/proCheckout.ts), never by this page.

/** The admin flag that shows the plan choices on the home page (off until switched on in Admin → Flags). */
export const CHOICES_FLAG = 'sitePlanChoices';

function ruleLive(rule, nowMs) {
  if (!rule || typeof rule !== 'object') return false;
  const audience = rule.audience || {};
  // The website visitor has no account: only "everyone" and "people without an account" rules apply.
  if (!(audience.kind === 'any' || (audience.kind === 'plan' && audience.plan === 'unknown'))) return false;
  if (typeof rule.startsAtMs === 'number' && nowMs < rule.startsAtMs) return false;
  if (typeof rule.endsAtMs === 'number' && nowMs >= rule.endsAtMs) return false;
  return true;
}

/**
 * Is a public flag on for a website visitor right now? Returns { on, endsAtMs } where endsAtMs is the end of the rule
 * that switched it on (null when it runs until stopped). Anything malformed counts as off.
 */
export function publicFlag(document, key, nowMs) {
  const flags = document && document.payload && document.payload.flags;
  const flag = flags && Object.prototype.hasOwnProperty.call(flags, key) ? flags[key] : null;
  if (!flag || typeof flag !== 'object' || flag.kill) return { on: false, endsAtMs: null };
  const live = (Array.isArray(flag.rules) ? flag.rules : []).filter((rule) => ruleLive(rule, nowMs));
  // As in the app: on a tie a rule that switches the feature off wins.
  const unknownPlan = live.filter((rule) => rule.audience.kind === 'plan');
  const best = unknownPlan.length ? unknownPlan : live;
  if (best.length) {
    if (best.some((rule) => rule.enabled !== true)) return { on: false, endsAtMs: null };
    const ends = best.map((rule) => rule.endsAtMs).filter((ms) => typeof ms === 'number');
    return { on: true, endsAtMs: ends.length === best.length ? Math.min(...ends) : null };
  }
  return { on: flag.default === true, endsAtMs: null };
}

/**
 * What the page shows: the choices, and the offer banner (only ever inside the choices). The offer is the Paddle
 * discount as the server reads it from Paddle (/v1/billing/offer): { live, lastDay }. The banner needs a last day.
 */
export function planChoicesView(document, nowMs, offer) {
  const choices = publicFlag(document, CHOICES_FLAG, nowMs);
  const lastDay = offer && offer.live === true && typeof offer.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(offer.lastDay) ? offer.lastDay : null;
  return { showChoices: choices.on, showPromo: choices.on && !!lastDay, promoLastDay: choices.on ? lastDay : null };
}
