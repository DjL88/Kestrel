/**
 * A second opinion on a photo's colour and light from the person's own AI provider (bring your own key or local
 * model). Pure: the question, the shape the answer must take, and a strict check of the answer. Nothing here sends
 * anything; `src/providers/aiProviders.ts` does that, only after the person has agreed.
 *
 * Rules (PRODUCT-SPEC §5): the AI never edits. It may only describe in plain words and suggest bounded slider values,
 * which InFlight shows for the person to Apply or ignore, as one undoable step. People are never named or described.
 */
import { parseRecipeProposal, type RecipeProposal } from './recipeProposal';

export const AI_REVIEW_ISSUES = ['tooStrong', 'tooWeak', 'cast', 'clipping', 'skin', 'redGreen', 'flat', 'tooDark', 'tooBright', 'other'] as const;
export type AiReviewIssue = (typeof AI_REVIEW_ISSUES)[number];

export interface AiReview {
  /** One or two plain sentences about the photo's colour and light. */
  summary: string;
  /** At most four points, each with a kind (for an icon and a label) and a short sentence. */
  points: { issue: AiReviewIssue; detail: string }[];
  /** Suggested slider values, already checked and clamped; empty when the photo is fine as it is. */
  suggestion: RecipeProposal;
}

/** Sliders an AI may suggest for colour and light. Detail and noise are judged on the device, at full size. */
const ALLOWED = ['exposure', 'warmth', 'colour', 'vibrance', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const;

/**
 * The question. `languageName` is the person's language in English (e.g. "Welsh") so the answer reads naturally to
 * them; `local` is the on-device colour check's own findings, so the AI can agree or disagree with them.
 */
export function aiReviewPrompt(languageName: string, local: string[]): string {
  return [
    'You are helping a photographer, who may be colour-blind, judge the colour and light in one photo.',
    'Be honest and specific: say which colours look too strong, too weak or tinted, where detail is lost, and whether skin, sky,',
    'foliage, feathers or fur look natural. Name colours in plain words. Never describe, identify or name any person.',
    `Write every sentence in ${languageName}, in plain, calm, everyday words, no jargon.`,
    local.length ? `An on-device check found: ${local.join(' ')} Agree or disagree with reasons.` : '',
    'Answer only with JSON in this form: {"summary": "1-2 sentences", "points": [{"issue": one of ' + AI_REVIEW_ISSUES.join('|') + ', "detail": "one sentence"}],',
    `"suggestion": {slider: number}}. Sliders allowed: ${ALLOWED.map((key) => `${key} (-2 to 2, 0 is unchanged)`).join(', ')}.`,
    'Suggest only small changes, and leave suggestion empty ({}) if the photo already looks right. At most four points.',
  ].filter(Boolean).join(' ');
}

/** JSON Schema for providers that can enforce the shape (Gemini, Anthropic structured outputs, OpenAI json_schema). */
export const AI_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'points', 'suggestion'],
  properties: {
    summary: { type: 'string' },
    points: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['issue', 'detail'],
        properties: { issue: { type: 'string', enum: [...AI_REVIEW_ISSUES] }, detail: { type: 'string' } },
      },
    },
    suggestion: {
      type: 'object', additionalProperties: false,
      properties: Object.fromEntries(ALLOWED.map((key) => [key, { type: 'number' }])),
    },
  },
} as const;

/** Plain text only: no markup, links or code, trimmed to a sensible length. Returns null if nothing usable is left. */
function sentence(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/<[^>]*>/g, '').replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/[`*_#>{}[\]\\]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Check an AI's answer and keep only what is safe and expected, or return null. Tolerates a code fence around the
 * JSON. Unknown fields are ignored; slider values are clamped and rounded by `parseRecipeProposal`, then limited to
 * colour and light sliders.
 */
export function parseAiReview(text: string): AiReview | null {
  let data: unknown;
  try { data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const summary = sentence(record.summary, 280);
  if (!summary) return null;
  const points = (Array.isArray(record.points) ? record.points : [])
    .flatMap((point) => {
      if (!point || typeof point !== 'object') return [];
      const { issue, detail } = point as Record<string, unknown>;
      const said = sentence(detail, 200);
      if (!said) return [];
      return [{ issue: (AI_REVIEW_ISSUES as readonly unknown[]).includes(issue) ? issue as AiReviewIssue : 'other', detail: said }];
    })
    .slice(0, 4);
  const proposal = parseRecipeProposal(record.suggestion ?? {}) ?? {};
  const suggestion: RecipeProposal = {};
  for (const key of ALLOWED) if (typeof proposal[key] === 'number') suggestion[key] = proposal[key];
  return { summary, points, suggestion };
}

/** Version of what the person agrees to; asking again whenever the terms or destination change. */
export const AI_REVIEW_CONSENT_VERSION = 'review-1';
/** The preview sent: long edge in pixels, JPEG, no metadata (location, camera, file name are never included). */
export const AI_REVIEW_EDGE = 1024;
