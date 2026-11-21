/**
 * Deciding what to trust when a model reads text in a photograph (an aircraft registration, a bird's leg ring).
 *
 * The reader is a small offline model and it makes mistakes: in testing it turned `N738PA` into `N73RPA` and
 * `EB 74918` into `EB 74018` and `E874918`, with the same confidence as a correct read. So one reading is never
 * enough. A second reading, zoomed in on just that text, is taken when the person interacts with the photo, and a
 * bounded tie-break at other zoom levels settles disagreements by vote, with format-valid readings counting.
 * Nothing here is a fact about the photo: the result is a suggestion the person confirms, like a subject tag.
 *
 * Pure: no model, no I/O. The reader supplies strings; this decides.
 */

export type TextKind = 'uk-registration' | 'us-registration' | 'civil-registration' | 'ring-like';
export type ReadingSource = 'subject' | 'zoom' | 'zoom-alt';
export interface TextRead { text: string; source: ReadingSource }

export type TextState =
  /** Nothing readable, or nothing in a format we recognise. Never offered. */
  | 'rejected'
  /** One reading, format fits, not yet checked by a zoomed second reading. Offered only quietly, as unconfirmed. */
  | 'candidate'
  /** Readings agree (or clearly win a vote) on a valid format. Still a suggestion for the person to confirm. */
  | 'agreed'
  /** Readings disagree and no valid reading clearly wins. Both are kept for the person; nothing is chosen. */
  | 'needs-review';
export type Confidence = 'high' | 'medium' | 'low';

export interface TextCandidate { text: string; display: string; kind: TextKind; votes: number }
export interface TextVerdict {
  state: TextState;
  /** The suggested text, only for `agreed` and `candidate`. */
  text: string | null;
  display: string | null;
  kind: TextKind | null;
  confidence: Confidence;
  /** Format-valid readings, most votes first. For `needs-review` the person sees these. */
  candidates: TextCandidate[];
  reads: number;
}

/** Upper-case, letters and digits only: how readings are compared. */
export function normaliseText(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const US_NUMBER = [/^N[1-9]\d{0,4}$/, /^N[1-9]\d{0,3}[A-HJ-NP-Z]$/, /^N[1-9]\d{0,2}[A-HJ-NP-Z]{2}$/];

/**
 * Does this look like a registration or ring? Deliberately narrow for registrations (a stray word must not pass) and
 * loose for rings, whose formats differ by scheme. `raw` keeps the hyphen, which marks other countries' registrations.
 */
export function classifyText(raw: string): { kind: TextKind; display: string } | null {
  const text = normaliseText(raw);
  if (/^G[A-Z]{4}$/.test(text)) return { kind: 'uk-registration', display: `G-${text.slice(1)}` };
  if (US_NUMBER.some((pattern) => pattern.test(text))) return { kind: 'us-registration', display: text };
  const hyphenated = /^\s*([A-Z]{1,2})-([A-Z0-9]{3,5})\s*$/i.exec(raw);
  if (hyphenated) return { kind: 'civil-registration', display: `${hyphenated[1]}-${hyphenated[2]}`.toUpperCase() };
  const ring = /^([A-Z]{1,3})(\d{3,7})$/.exec(text);
  // A lone N followed by digits is a malformed US registration far more often than a ring, so it is not offered as one.
  if (ring && ring[1] !== 'N') return { kind: 'ring-like', display: `${ring[1]} ${ring[2]}` };
  return null;
}

export function judgeReadings(reads: readonly TextRead[]): TextVerdict {
  const taken = reads.filter((read) => normaliseText(read.text).length >= 2);
  const tally = new Map<string, TextCandidate>();
  for (const read of taken) {
    const kind = classifyText(read.text);
    if (!kind) continue;
    const key = normaliseText(read.text);
    const entry = tally.get(key);
    if (entry) entry.votes++;
    else tally.set(key, { text: key, display: kind.display, kind: kind.kind, votes: 1 });
  }
  const candidates = [...tally.values()].sort((a, b) => b.votes - a.votes || a.text.localeCompare(b.text));
  const base = { candidates, reads: taken.length };
  if (candidates.length === 0) return { ...base, state: 'rejected', text: null, display: null, kind: null, confidence: 'low' };
  const [top, runnerUp] = candidates;
  if (taken.length === 1) {
    return { ...base, state: 'candidate', text: top.text, display: top.display, kind: top.kind, confidence: 'low' };
  }
  // Agreement needs at least two identical valid readings, strictly ahead of any other valid reading.
  if (top.votes >= 2 && (!runnerUp || top.votes > runnerUp.votes)) {
    const confidence: Confidence = top.votes / taken.length >= 2 / 3 ? 'high' : 'medium';
    return { ...base, state: 'agreed', text: top.text, display: top.display, kind: top.kind, confidence };
  }
  return { ...base, state: 'needs-review', text: null, display: null, kind: null, confidence: 'low' };
}

export type NextStep =
  /** Nothing more to do now. */
  | 'done'
  /** Read the subject area once. */
  | 'first-pass'
  /** Read again, zoomed on the text. */
  | 'zoom'
  /** Read again at another zoom to settle a disagreement or a weak result. */
  | 'tie-break'
  /** Worth confirming, but wait until the person interacts with this photo. */
  | 'wait';

export const MAX_READS = 6;

export interface PlanOptions {
  /** The person opened, zoomed or edited this photo since the last reading. */
  interacted: boolean;
  /** The model's own reading looked doubtful (blurred, tiny, low contrast), when it can say. */
  lowConfidence?: boolean;
  maxReads?: number;
}

/**
 * What to do next for one text region. The first reading runs once, in the background. The zoomed re-read and any
 * tie-break wait for the person to interact with the photo, so unviewed photos cost one cheap pass and no more.
 */
export function nextStep(reads: readonly TextRead[], options: PlanOptions): NextStep {
  const verdict = judgeReadings(reads);
  const limit = options.maxReads ?? MAX_READS;
  if (reads.length === 0) return 'first-pass';
  if (verdict.reads >= limit) return 'done';
  if (verdict.state === 'rejected') {
    // Tiny text can be misread into nonsense at first; zoom once if the first read looked like text at all.
    const looksLikeText = reads.length === 1 && normaliseText(reads[0].text).length >= 3 && options.lowConfidence === true;
    return looksLikeText ? (options.interacted ? 'zoom' : 'wait') : 'done';
  }
  const settled = verdict.state === 'agreed' && verdict.confidence === 'high' && options.lowConfidence !== true;
  if (settled) return 'done';
  if (!options.interacted) return 'wait';
  return reads.length === 1 ? 'zoom' : 'tie-break';
}

// ---- Where to zoom --------------------------------------------------------------------------------------------

export interface Box { x1: number; y1: number; x2: number; y2: number }
export interface ZoomPlan { crop: Box; scale: number; output: { width: number; height: number } }

const MODEL_INPUT = 768;
/** Zoom variants: the first is the standard confirming read, the others are tie-break reads at other crops. */
export const ZOOM_VARIANTS = [
  { padding: 0.25, minWidth: 256 }, { padding: 0.15, minWidth: 200 }, { padding: 0.4, minWidth: 300 },
  { padding: 0.25, minWidth: 420 }, { padding: 0.15, minWidth: 300 },
] as const;

/**
 * The crop to read for a text region: padded so letters at the edge are whole, enlarged so the text is big enough for
 * the model, never beyond the model's own input size, and never outside the image.
 */
export function planZoom(region: Box, image: { width: number; height: number }, variant = 0): ZoomPlan {
  const { padding, minWidth } = ZOOM_VARIANTS[Math.min(Math.max(variant, 0), ZOOM_VARIANTS.length - 1)];
  const width = Math.max(1, region.x2 - region.x1);
  const height = Math.max(1, region.y2 - region.y1);
  const crop: Box = {
    x1: Math.max(0, Math.floor(region.x1 - width * padding)), y1: Math.max(0, Math.floor(region.y1 - height * padding)),
    x2: Math.min(image.width, Math.ceil(region.x2 + width * padding)), y2: Math.min(image.height, Math.ceil(region.y2 + height * padding)),
  };
  const cropWidth = Math.max(1, crop.x2 - crop.x1);
  const cropHeight = Math.max(1, crop.y2 - crop.y1);
  const wanted = Math.max(1, minWidth / cropWidth);
  const scale = Math.min(Math.max(1, wanted), MODEL_INPUT / Math.max(cropWidth, cropHeight));
  const finalScale = Math.max(1, scale);
  return { crop, scale: finalScale, output: { width: Math.round(cropWidth * finalScale), height: Math.round(cropHeight * finalScale) } };
}
