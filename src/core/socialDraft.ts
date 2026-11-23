/**
 * Consent-led offline social caption drafts. This module never processes pixels,
 * stores data, calls a model, or sends a post to a social network.
 *
 * Only human-confirmed, explicitly shareable facts may enter a draft.
 * AI/OCR guesses and private project metadata are not valid inputs.
 */
export type SocialDestination = 'instagram' | 'facebook' | 'tiktok' | 'x' | 'other';
export type CaptionTone = 'natural' | 'concise';

export interface SocialDraftInput {
  destination: SocialDestination;
  tone?: CaptionTone;
  /** Explicitly approved for this post; not inferred from a face, OCR or model. */
  shareableSubject?: string;
  /** Project titles can identify private customers; opt in per draft. */
  shareProjectTitle?: boolean;
  projectTitle?: string;
  /** Photographer-authored text explicitly approved to appear publicly. */
  approvedNote?: string;
  /** Explicitly approved terms, never unreviewed automatic tags. */
  approvedTags?: readonly string[];
}
export interface SocialDraft {
  destination: SocialDestination;
  caption: string;
  hashtags: string[];
  /** For platforms with a plain text editor; nothing is transmitted. */
  copyText: string;
  status: 'suggestion';
  requiresReview: true;
  onlineUsed: false;
  published: false;
}

const DESTINATIONS: ReadonlySet<string> = new Set(['instagram', 'facebook', 'tiktok', 'x', 'other']);
const MAX_CAPTION = 1500;
const MAX_TAGS = 8;

/** Strip controls and markup-like characters from untrusted human text. */
function clean(value: string | undefined, max: number): string {
  return (value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function tagFrom(value: string): string {
  const raw = clean(value, 60).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const words = raw.replace(/^#+/, '').match(/[\p{L}\p{N}]+/gu);
  if (!words) return '';
  return words.join('').slice(0, 36);
}

/** Makes an editable UK-English suggestion, never a publish action or an AI fact claim. */
export function createSocialDraft(input: SocialDraftInput): SocialDraft {
  if (!DESTINATIONS.has(input.destination)) throw new Error('Unsupported social destination');
  const note = clean(input.approvedNote, 700);
  const subject = clean(input.shareableSubject, 90);
  const project = input.shareProjectTitle === true ? clean(input.projectTitle, 120) : '';
  const parts: string[] = [];

  if (subject && project) {
    parts.push(input.tone === 'concise' ? `${subject} · ${project}` : `${subject}, from ${project}.`);
  } else if (subject) {
    parts.push(input.tone === 'concise' ? subject : `A closer look at ${subject}.`);
  } else if (project) {
    parts.push(input.tone === 'concise' ? project : `A photograph from ${project}.`);
  }
  if (note) parts.push(note);
  if (!parts.length) parts.push('A photograph to share.');

  // Do not automatically reveal subject/project names as hashtags.
  const hashtags: string[] = [], seen = new Set<string>();
  for (const candidate of input.approvedTags ?? []) {
    const word = tagFrom(candidate);
    if (!word || word.length < 2) continue;
    const key = word.toLocaleLowerCase('en-GB');
    if (seen.has(key)) continue;
    seen.add(key);
    hashtags.push('#' + word);
    if (hashtags.length >= MAX_TAGS) break;
  }

  let caption = parts.join('\n\n').slice(0, MAX_CAPTION).trim();
  // The X destination uses a conservative character ceiling for draft text.
  if (input.destination === 'x') {
    caption = caption.slice(0, 280).trim();
    while (hashtags.length && (caption + '\n\n' + hashtags.join(' ')).length > 280) hashtags.pop();
  }
  const copyText = caption + (hashtags.length ? '\n\n' + hashtags.join(' ') : '');
  return {
    destination: input.destination, caption, hashtags, copyText,
    status: 'suggestion', requiresReview: true, onlineUsed: false, published: false,
  };
}
