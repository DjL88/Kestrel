/**
 * Feature flags: one pure evaluator for "is this feature on for this person right now?".
 *
 * The rules come from the control plane (Firestore) and travel inside the signed entitlement grant, or in a signed
 * public document for people without an account. This module only evaluates them. It never fetches anything, so every
 * feature keeps working offline from the last verified rules, or from the compiled defaults in `features.ts`.
 *
 * Audiences: Unknown (no account), Basic, Pro, a named Corporate organisation, or one named user. A rule can switch a
 * feature on or off for an audience, inside an optional date range. A rule with no end date runs until it is stopped.
 * A rule marked `trial` makes the interface say "Trial". See docs/V2-WORKSPACE.md section 12.
 */

export type PlanAudience = 'unknown' | 'basic' | 'pro';

/** Who is asking. `plan` is always set. `corporate` and `user` are set only when known. */
export interface Audience {
  plan: PlanAudience;
  corporate?: string;
  /** The account's email, or any stable key the control plane uses for that user. Compared case-insensitively. */
  user?: string;
}

export type AudienceMatcher =
  | { kind: 'any' }
  | { kind: 'plan'; plan: PlanAudience }
  | { kind: 'corporate'; name: string }
  | { kind: 'user'; email: string };

export interface FlagRule {
  audience: AudienceMatcher;
  enabled: boolean;
  /** Epoch ms. Missing or null means "already started". */
  startsAtMs?: number | null;
  /** Epoch ms, exclusive. Missing or null means "until stopped". */
  endsAtMs?: number | null;
  /** True for a trial release: the interface marks the feature as a trial while it is on. */
  trial?: boolean;
  /** 0 to 100. Only devices whose private bucket is below this number get the rule. Missing means everyone. */
  percent?: number;
}

export interface FlagDefinition {
  default: boolean;
  /** Instant off for everyone, except features that are never gated. */
  kill?: boolean;
  /** Dotted version such as 26.11.2. An older app sees the feature off. */
  minAppVersion?: string;
  rules: FlagRule[];
}

export type FlagSet = Readonly<Record<string, FlagDefinition>>;

export interface EvaluationContext {
  audience: Audience;
  nowMs: number;
  /** A random number from 0 to 99 kept only on this device and never sent anywhere. Missing counts as 100 (outside every rollout). */
  bucket?: number;
  appVersion?: string;
  /** Features that no flag can ever switch off (originals, export, backup, basic editing). */
  neverGated?: ReadonlySet<string>;
}

export type Reason =
  | 'never-gated' | 'kill-switch' | 'app-too-old' | 'rule-user' | 'rule-corporate' | 'rule-plan' | 'rule-any' | 'default' | 'unknown-flag';

export interface Evaluation {
  on: boolean;
  reason: Reason;
  /** True only when the feature is on because of a trial rule. */
  trial: boolean;
}

const SPECIFICITY = { any: 1, plan: 2, corporate: 3, user: 4 } as const;
const REASON: Record<AudienceMatcher['kind'], Reason> = { any: 'rule-any', plan: 'rule-plan', corporate: 'rule-corporate', user: 'rule-user' };

const same = (a: string | undefined, b: string) => typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

export function matchesAudience(matcher: AudienceMatcher, audience: Audience): boolean {
  switch (matcher.kind) {
    case 'any': return true;
    case 'plan': return audience.plan === matcher.plan;
    case 'corporate': return same(audience.corporate, matcher.name);
    case 'user': return same(audience.user, matcher.email);
  }
}

/** Compare dotted numeric versions. Returns a negative number when a is older than b. Non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function ruleApplies(rule: FlagRule, context: EvaluationContext): boolean {
  if (!matchesAudience(rule.audience, context.audience)) return false;
  if (typeof rule.startsAtMs === 'number' && context.nowMs < rule.startsAtMs) return false;
  if (typeof rule.endsAtMs === 'number' && context.nowMs >= rule.endsAtMs) return false;
  if (typeof rule.percent === 'number' && (context.bucket ?? 100) >= rule.percent) return false;
  return true;
}

/**
 * Order: never-gated, kill switch, app version, then the most specific matching rule (user, then corporate, then plan,
 * then any). On a tie a rule that switches the feature off beats one that switches it on. With no matching rule the flag's default applies.
 */
export function evaluateFlag(key: string, flags: FlagSet, fallback: FlagSet, context: EvaluationContext): Evaluation {
  if (context.neverGated?.has(key)) return { on: true, reason: 'never-gated', trial: false };
  const flag = flags[key] ?? fallback[key];
  if (!flag) return { on: false, reason: 'unknown-flag', trial: false };
  if (flag.kill) return { on: false, reason: 'kill-switch', trial: false };
  if (flag.minAppVersion && context.appVersion && compareVersions(context.appVersion, flag.minAppVersion) < 0) {
    return { on: false, reason: 'app-too-old', trial: false };
  }
  let best: FlagRule | null = null;
  for (const rule of flag.rules) {
    if (!ruleApplies(rule, context)) continue;
    if (!best) { best = rule; continue; }
    const more = SPECIFICITY[rule.audience.kind] - SPECIFICITY[best.audience.kind];
    if (more > 0 || (more === 0 && !rule.enabled && best.enabled)) best = rule;
  }
  if (best) return { on: best.enabled, reason: REASON[best.audience.kind], trial: best.enabled && best.trial === true };
  return { on: flag.default, reason: 'default', trial: false };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const optionalTime = (value: unknown) => value === undefined || value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);

function parseMatcher(value: unknown): AudienceMatcher | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'any') return { kind: 'any' };
  if (value.kind === 'plan' && (value.plan === 'unknown' || value.plan === 'basic' || value.plan === 'pro')) return { kind: 'plan', plan: value.plan };
  if (value.kind === 'corporate' && typeof value.name === 'string' && value.name.trim() && value.name.length <= 120) return { kind: 'corporate', name: value.name };
  if (value.kind === 'user' && typeof value.email === 'string' && value.email.trim() && value.email.length <= 254) return { kind: 'user', email: value.email };
  return null;
}

function parseRule(value: unknown): FlagRule | null {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') return null;
  const audience = parseMatcher(value.audience);
  if (!audience || !optionalTime(value.startsAtMs) || !optionalTime(value.endsAtMs)) return null;
  if (value.percent !== undefined && !(typeof value.percent === 'number' && value.percent >= 0 && value.percent <= 100)) return null;
  const rule: FlagRule = { audience, enabled: value.enabled };
  if (typeof value.startsAtMs === 'number') rule.startsAtMs = value.startsAtMs;
  if (typeof value.endsAtMs === 'number') rule.endsAtMs = value.endsAtMs;
  if (value.trial === true) rule.trial = true;
  if (typeof value.percent === 'number') rule.percent = value.percent;
  return rule;
}

/**
 * Read a flag set from a document that has already passed signature checks. Anything malformed is dropped, never
 * guessed at, so a bad rule can only make a flag fall back to its default.
 */
export function parseFlagSet(value: unknown): FlagSet {
  if (!isRecord(value)) return {};
  const out: Record<string, FlagDefinition> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || !isRecord(raw) || typeof raw.default !== 'boolean') continue;
    const rules = Array.isArray(raw.rules) ? raw.rules.map(parseRule).filter((rule): rule is FlagRule => rule !== null) : [];
    const flag: FlagDefinition = { default: raw.default, rules };
    if (raw.kill === true) flag.kill = true;
    if (typeof raw.minAppVersion === 'string' && /^\d+(\.\d+){0,3}$/.test(raw.minAppVersion)) flag.minAppVersion = raw.minAppVersion;
    out[key] = flag;
  }
  return out;
}

/**
 * The public document for people without an account carries no names or emails. Rules for a named user or a named
 * organisation are removed, because the public document is readable by anyone.
 */
export function forPublicDocument(flags: FlagSet): FlagSet {
  const out: Record<string, FlagDefinition> = {};
  for (const [key, flag] of Object.entries(flags)) {
    out[key] = { ...flag, rules: flag.rules.filter((rule) => rule.audience.kind === 'any' || rule.audience.kind === 'plan') };
  }
  return out;
}

/** A random device bucket from 0 to 99, for percentage rollouts. Keep it on the device and never send it. */
export function newBucket(random: () => number = Math.random): number {
  return Math.min(99, Math.max(0, Math.floor(random() * 100)));
}
