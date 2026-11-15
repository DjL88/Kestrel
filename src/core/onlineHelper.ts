import { mayAutoTag, type AutoState } from './autoTags';
import { addTags, cleanTag, isSubjectKind, type SubjectKind } from './subjectTags';

/** What the online helper says about a photo, after it has been checked. Never used as it arrives. */
export interface HelperAnswer {
  kind: SubjectKind;
  /** Common name of the main animal or bird, when the photo is of wildlife and the helper knows it. */
  species: string | null;
  scientific: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Up to three short descriptive words, such as "in flight". Offered as suggestions only. */
  tags: string[];
}

/** The question, and the shape the answer must take. People are only ever classed, never named. */
export const HELPER_PROMPT = [
  'You are helping a wildlife photographer organise their photos. Look at the photo and answer in the given JSON form.',
  'kind: wildlife, people, landscape or other. species: the common name (British English) of the main animal or bird when the photo is of wildlife and you know it, otherwise null.',
  'scientific: its Latin name or null. confidence: high only when you are sure of the species; medium when it is probably right; low when you are guessing.',
  'tags: up to three short descriptive words such as "in flight" or "moorland".',
  'Never name or describe any real person. For photos of people answer kind people with species null. If unsure, say so with low confidence and null.',
].join(' ');

export const HELPER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['wildlife', 'people', 'landscape', 'other'] },
    species: { type: 'STRING', nullable: true },
    scientific: { type: 'STRING', nullable: true },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['kind', 'confidence'],
} as const;

/** Text from the helper becomes a tag, so it is held to what a tag may be: short, plain, and not a link or markup. */
function plain(value: unknown, max = 40): string | null {
  if (typeof value !== 'string') return null;
  const text = cleanTag(value);
  if (!text || text.length > max || /[<>{}\\]|https?:|www\.|\.(com|org|net)\b/i.test(text)) return null;
  return text;
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Check the helper's reply and keep only what is safe and sensible, or return null. It tolerates a reply wrapped in a
 * code fence, and ignores anything it does not expect. A person is never given a species.
 */
export function parseHelperAnswer(text: string): HelperAnswer | null {
  let data: unknown;
  try { data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return null; }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (!isSubjectKind(record.kind)) return null;
  const confidence = record.confidence === 'high' || record.confidence === 'medium' ? record.confidence : 'low';
  const person = record.kind === 'people';
  const common = person ? null : plain(record.species);
  const species = common ? sentence(common) : null;
  const scientific = species ? plain(record.scientific, 60) : null;
  const tags = Array.isArray(record.tags) ? addTags([], record.tags.map((tag) => plain(tag, 30)).filter((tag): tag is string => tag !== null)).slice(0, 3) : [];
  return { kind: record.kind, species, scientific, confidence: species ? confidence : 'low', tags };
}

/** What to store for a photo after the helper has answered. The same cautious rules as the on-device model. */
export function helperPatch(
  frame: { tags?: readonly string[]; subjectNames?: readonly string[]; subjectKind?: string } & AutoState,
  answer: HelperAnswer,
): { speciesChecked: true; tags?: string[]; autoTags?: string[]; subjectKind?: SubjectKind } {
  const patch: { speciesChecked: true; tags?: string[]; autoTags?: string[]; subjectKind?: SubjectKind } = { speciesChecked: true };
  // The kind is only set where none was chosen, and not from a guess.
  if (!frame.subjectKind && answer.confidence !== 'low') patch.subjectKind = answer.kind;
  if (answer.species && answer.confidence === 'high' && mayAutoTag(frame, answer.species)) {
    patch.tags = addTags(frame.tags ?? [], [answer.species]);
    patch.autoTags = addTags(frame.autoTags ?? [], [answer.species]);
  }
  return patch;
}

/** Pick a current, cheap, capable model from what the key can use, so no model name is built into the app. */
export function pickModel(models: readonly { name: string; supportedGenerationMethods?: readonly string[] }[]): string | null {
  const version = (name: string) => (name.match(/gemini-(\d+(?:\.\d+)*)/)?.[1] ?? '0').split('.').map(Number);
  const newer = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i += 1) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; } return 0; };
  const candidates = models
    .map((model) => ({ id: model.name.replace(/^models\//, ''), methods: model.supportedGenerationMethods ?? [] }))
    .filter(({ id, methods }) => methods.includes('generateContent') && /^gemini-[\d.]+-flash(?!-lite)/.test(id) && !/image|tts|audio|live|embed|vision|thinking|exp|8b/.test(id));
  if (!candidates.length) return null;
  const rank = (id: string) => (/preview/.test(id) ? 0 : 1);
  candidates.sort((a, b) => rank(b.id) - rank(a.id) || newer(version(b.id), version(a.id)) || a.id.length - b.id.length);
  return candidates[0].id;
}

/** The terms the user agrees to, versioned so a change in what is sent asks again. */
export const HELPER_CONSENT_VERSION = 'gemini-1';

export interface HelperSettings { enabled: boolean; consent: string | null; key: string }

export function helperReady(settings: HelperSettings, state: { online: boolean }): boolean {
  return settings.enabled && settings.consent === HELPER_CONSENT_VERSION && settings.key.trim().length > 0 && state.online;
}

/** The most photos sent in one session and the pause between them, so a big import cannot run up a bill or hit limits. */
export const HELPER_SESSION_CAP = 100;
export const HELPER_GAP_MS = 1500;

export type HelperFailure = 'offline' | 'auth' | 'rate' | 'blocked' | 'other';

/** Words for the user. Only some failures stop everything: a bad key or a rate limit will repeat for every photo. */
export function failureMessage(failure: HelperFailure): { text: string; stops: boolean } {
  switch (failure) {
    case 'auth': return { text: 'The online helper did not accept your key. Check it in the helper settings.', stops: true };
    case 'rate': return { text: 'The online helper is busy or the daily limit was reached. It will try again later.', stops: true };
    case 'offline': return { text: '', stops: true };
    case 'blocked': return { text: '', stops: false };
    default: return { text: '', stops: false };
  }
}
