import { resolvePhotographyGuidance, type PhotographyObservation } from './photographyKnowledge';
import { citationsFor } from './photographyKnowledgeSources';
import { preservationPolicy } from './photographyPolicy';
import { statObservations, type FrameStats } from './enhanceObserve';

/**
 * Enhance loop, step 2: GUIDE. Turns measured statistics and on-device vision observations into the knowledge-base rules
 * that apply, with each rule's checked sources. Rules say which DIRECTION to edit and what to protect; the amount always
 * comes from the measurements in enhanceRecipe.ts. A label never sets a slider value.
 */

/** What the on-device vision AI said it saw. Anything it was unsure of is simply not listed. */
export interface VisionObservationInput {
  dimension: PhotographyObservation['dimension'];
  label: string;
  confidence: number;
}

/** The controls a recipe step may move, as the editor's own slider names. */
export type StepControl =
  | 'exposure' | 'warmth' | 'tint' | 'shadows' | 'highlights' | 'contrast' | 'vibrance'
  | 'denoise' | 'denoiseLuminance' | 'texture' | 'clarity' | 'sharpen';
export type Direction = 'up' | 'down';

/** Which controls and directions each rule asks for. A rule that only protects (low key, fog) lists none. */
export const RULE_INTENTS: Readonly<Record<string, readonly { control: StepControl; direction: Direction; scope?: 'subject' }[]>> = {
  'lighting.underexposure': [{ control: 'exposure', direction: 'up' }, { control: 'shadows', direction: 'up' }],
  'lighting.underexposed-raw': [{ control: 'exposure', direction: 'up' }, { control: 'denoise', direction: 'up' }, { control: 'denoiseLuminance', direction: 'up' }],
  'lighting.overexposure': [{ control: 'exposure', direction: 'down' }, { control: 'highlights', direction: 'down' }],
  'lighting.clipped-highlights': [{ control: 'highlights', direction: 'down' }, { control: 'exposure', direction: 'down' }],
  'lighting.high-iso-shadows': [{ control: 'denoise', direction: 'up' }, { control: 'denoiseLuminance', direction: 'up' }],
  'lighting.high-dynamic-range': [{ control: 'highlights', direction: 'down' }, { control: 'shadows', direction: 'up' }],
  'lighting.bright-background': [{ control: 'exposure', direction: 'up', scope: 'subject' }],
  'lighting.backlit': [{ control: 'exposure', direction: 'up', scope: 'subject' }, { control: 'shadows', direction: 'up' }],
  'lighting.harsh-midday': [{ control: 'highlights', direction: 'down' }, { control: 'shadows', direction: 'up' }],
  'style.natural': [{ control: 'contrast', direction: 'up' }, { control: 'vibrance', direction: 'up' }],
  'subject.perched-bird': [{ control: 'vibrance', direction: 'up' }, { control: 'sharpen', direction: 'up', scope: 'subject' }],
  'subject.bird-in-flight': [{ control: 'vibrance', direction: 'up' }, { control: 'sharpen', direction: 'up', scope: 'subject' }],
  'subject.garden-bird': [{ control: 'vibrance', direction: 'up' }, { control: 'sharpen', direction: 'up', scope: 'subject' }],
  'subject.wildlife-in-habitat': [{ control: 'vibrance', direction: 'up' }, { control: 'sharpen', direction: 'up', scope: 'subject' }],
  'scene.feathers': [{ control: 'sharpen', direction: 'up', scope: 'subject' }],
  'scene.fur': [{ control: 'sharpen', direction: 'up', scope: 'subject' }],
  'subject.aviation': [{ control: 'sharpen', direction: 'up', scope: 'subject' }],
  'subject.mountains': [{ control: 'clarity', direction: 'up' }, { control: 'contrast', direction: 'up' }],
  'subject.architecture': [{ control: 'clarity', direction: 'up' }],
  'subject.insect-macro': [{ control: 'sharpen', direction: 'up', scope: 'subject' }],
  'scene.skin': [{ control: 'texture', direction: 'down' }],
};

export interface GuidedRule {
  id: string;
  label: string;
  guidance: string;
  status: string;
  /** Checked source ids; empty means the rule is house practice (never presented as sourced). */
  sources: string[];
  /** How the rule came to apply: a pixel measurement, or the on-device vision AI. */
  via: 'measured' | 'vision' | 'both';
  /** The measurement behind it, in words, when measured. */
  evidence?: string;
  confidence: number;
}

export interface Guidance {
  version: string;
  rules: GuidedRule[];
  hardGates: readonly string[];
  /** Protections from rules: light or dark or softness the edit must leave alone. */
  protect: { light: boolean; dark: boolean; soft: boolean };
  /** Observations that were too uncertain to use. Reported, never acted on. */
  unknown: PhotographyObservation[];
}

export const GUIDE_CONFIDENCE = 0.8;

export function resolveGuidance(stats: FrameStats, vision: readonly VisionObservationInput[] = [], chosenStyle: string | null = 'natural', extra: { observation: PhotographyObservation; evidence: string }[] = []): Guidance {
  const measured = [...statObservations(stats), ...extra];
  // The person's chosen style (Natural by default) is an explicit choice, so it resolves with full confidence.
  const chosen: PhotographyObservation[] = chosenStyle ? [{ dimension: 'style', label: chosenStyle, confidence: 1 }] : [];
  const all: PhotographyObservation[] = [...measured.map((m) => m.observation), ...chosen, ...vision.filter((v) => Number.isFinite(v.confidence))];
  const resolved = resolvePhotographyGuidance(all, GUIDE_CONFIDENCE);
  const idOf = (o: { dimension: string; label: string }) => `${o.dimension}.${o.label.trim().toLowerCase().replaceAll(' ', '-')}`;
  const rules: GuidedRule[] = resolved.rules.map((r) => {
    const m = measured.find((x) => idOf(x.observation) === r.id);
    const v = vision.find((x) => idOf(x) === r.id && x.confidence >= GUIDE_CONFIDENCE);
    return {
      id: r.id, label: r.label, guidance: r.guidance, status: r.status,
      sources: citationsFor(r.id).map((c) => c.source.id),
      via: m && v ? 'both' : m ? 'measured' : 'vision', evidence: m?.evidence,
      confidence: Math.max(m?.observation.confidence ?? 0, v?.confidence ?? 0),
    };
  });
  const policy = preservationPolicy(all.filter((o) => o.confidence >= GUIDE_CONFIDENCE));
  return {
    version: resolved.version, rules, hardGates: resolved.hardGates,
    protect: { light: policy.preserveLight, dark: policy.preserveDark, soft: policy.preserveSoft },
    unknown: all.filter((o) => o.confidence < GUIDE_CONFIDENCE),
  };
}

/** The first observed rule that asks for this control to move this way, or null (the step is then house practice). */
export function attributeStep(guidance: Guidance, control: StepControl, direction: Direction, scope: 'photo' | 'subject'): GuidedRule | null {
  for (const rule of guidance.rules) {
    const intents = RULE_INTENTS[rule.id];
    if (intents?.some((i) => i.control === control && i.direction === direction && (i.scope === 'subject') === (scope === 'subject'))) return rule;
  }
  // A whole-photo step may also be justified by a rule that asked for the same move locally.
  for (const rule of guidance.rules) if (RULE_INTENTS[rule.id]?.some((i) => i.control === control && i.direction === direction)) return rule;
  return null;
}
