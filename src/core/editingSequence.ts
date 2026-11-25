/**
 * The one interaction contract that people, tutorials, Co-pilot and Auto-pilot share (#1387). Each participant has a
 * name, initials and a cursor style; each automatic or demonstrated edit can be shown as an ordered sequence of real
 * slider steps. Instant mode applies the validated recipe as today; Watch plays the steps; Learn lets the person accept
 * or reject each one. Background work never waits for playback.
 */
import type { PhotoLease } from './photoLease';

export type ParticipantKind = 'human-editor' | 'human-reviewer' | 'anonymous-guest' | 'tutorial-guide' | 'copilot' | 'autopilot';

export interface ParticipantRules {
  cursor: 'shown' | 'optional';
  edits: 'yes' | 'no' | 'demonstration' | 'with-approval';
  /** `own`: needs its own lease; `acting-user`: works inside the lease of the person it acts for; `none`: never edits shared photos. */
  checkout: 'own' | 'acting-user' | 'none';
}

export const PARTICIPANT_RULES: Record<ParticipantKind, ParticipantRules> = {
  'human-editor': { cursor: 'shown', edits: 'yes', checkout: 'own' },
  'human-reviewer': { cursor: 'shown', edits: 'no', checkout: 'none' },
  'anonymous-guest': { cursor: 'optional', edits: 'no', checkout: 'none' },
  'tutorial-guide': { cursor: 'shown', edits: 'demonstration', checkout: 'none' },
  copilot: { cursor: 'shown', edits: 'with-approval', checkout: 'acting-user' },
  autopilot: { cursor: 'optional', edits: 'yes', checkout: 'acting-user' },
};

export interface Participant {
  id: string;
  kind: ParticipantKind;
  displayName: string;
  /** For Co-pilot and Auto-pilot: the account whose editing session they use. */
  actingForAccountId?: string;
  /** For people: their account. */
  accountId?: string;
}

/** Up to two initials, shown with the cursor and avatar, so a cursor is never identified by colour alone. */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[words.length - 1]][0]];
  return letters.join('').toLocaleUpperCase('en-GB');
}

/**
 * Whether this participant may change a photo now. In a project that is not shared there is no lease and only the
 * person (and the assistants acting for them) edit. In a shared one, Co-pilot and Auto-pilot never take a photo that
 * someone else has checked out: they need the lease of the person they act for.
 */
export function mayModifyPhoto(participant: Participant, shared: boolean, lease: PhotoLease | undefined): boolean {
  const rules = PARTICIPANT_RULES[participant.kind];
  if (rules.edits === 'no' || rules.edits === 'demonstration') return false;
  if (!shared) return true;
  const account = rules.checkout === 'own' ? participant.accountId : participant.actingForAccountId;
  return !!account && !!lease && lease.holderAccountId === account;
}

// ---- Cursors -----------------------------------------------------------------------------------------------------

/** A point on the photograph itself, 0–1 across and down, so it lands on the same feather at any zoom or screen size. */
export interface PhotoPoint { x: number; y: number }

/** Where the photograph is drawn on this screen right now, in screen pixels. */
export interface PhotoViewRect { left: number; top: number; width: number; height: number }

/** Null when the pointer is off the photograph: nothing is sent then. */
export function screenToPhoto(clientX: number, clientY: number, view: PhotoViewRect): PhotoPoint | null {
  if (!(view.width > 0 && view.height > 0)) return null;
  const x = (clientX - view.left) / view.width, y = (clientY - view.top) / view.height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

export function photoToScreen(point: PhotoPoint, view: PhotoViewRect): { x: number; y: number } {
  return { x: view.left + point.x * view.width, y: view.top + point.y * view.height };
}

/** Around 15 updates a second while moving; receivers interpolate. Positions are never stored or used to monitor anyone. */
export const CURSOR_MIN_INTERVAL_MS = Math.ceil(1000 / 15);

export function shouldSendCursor(lastSentMs: number | null, nowMs: number): boolean {
  return lastSentMs === null || nowMs - lastSentMs >= CURSOR_MIN_INTERVAL_MS;
}

// ---- Editing sequence ----------------------------------------------------------------------------------------------

export type PlaybackMode = 'instant' | 'watch' | 'learn';

export type StepGroup = 'white-balance' | 'light' | 'colour' | 'detail' | 'local' | 'other';

export interface EditingStep {
  id: string;
  key: string;
  group: StepGroup;
  /** The real values from and to. Not a number when the setting is a curve, mixer or other structured value. */
  from: unknown;
  to: unknown;
}

/**
 * The order a person would usually work in: balance, then light, then colour, then detail. Keys not listed here keep
 * their recipe order after the listed ones, so a new slider is still shown rather than dropped.
 */
export const STEP_ORDER: readonly { key: string; group: StepGroup }[] = [
  { key: 'whiteBalance', group: 'white-balance' }, { key: 'temperature', group: 'white-balance' }, { key: 'tint', group: 'white-balance' },
  { key: 'exposure', group: 'light' }, { key: 'contrast', group: 'light' }, { key: 'highlights', group: 'light' },
  { key: 'shadows', group: 'light' }, { key: 'whites', group: 'light' }, { key: 'blacks', group: 'light' }, { key: 'toneCurve', group: 'light' },
  { key: 'vibrance', group: 'colour' }, { key: 'saturation', group: 'colour' }, { key: 'colourMixer', group: 'colour' },
  { key: 'clarity', group: 'detail' }, { key: 'detailRecovery', group: 'detail' }, { key: 'sharpen', group: 'detail' },
  { key: 'denoiseLuminance', group: 'detail' }, { key: 'denoiseColour', group: 'detail' }, { key: 'upscaleFactor', group: 'detail' },
  { key: 'masks', group: 'local' },
];

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The ordered steps that turn `before` into `after`. Identical values make no step. `ignore` lists keys that are not adjustments (a look id, say). */
export function buildEditingSequence(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>, ignore: readonly string[] = []): EditingStep[] {
  const known = new Set(STEP_ORDER.map((entry) => entry.key));
  const keys = [...STEP_ORDER.map((entry) => entry.key), ...Object.keys(after).filter((key) => !known.has(key)), ...Object.keys(before).filter((key) => !known.has(key) && !(key in after))];
  const steps: EditingStep[] = [];
  for (const key of keys) {
    if (ignore.includes(key) || !(key in before || key in after) || sameValue(before[key], after[key])) continue;
    if (steps.some((step) => step.key === key)) continue;
    const group = STEP_ORDER.find((entry) => entry.key === key)?.group ?? 'other';
    steps.push({ id: `step-${steps.length + 1}-${key}`, key, group, from: before[key], to: after[key] });
  }
  return steps;
}

/**
 * The recipe after applying only the accepted steps, in order (Learn mode), or the first `count` (Watch mode). With
 * every step accepted the result equals `after` for every key the sequence covers.
 */
export function applySteps<T extends Record<string, unknown>>(before: T, steps: readonly EditingStep[], accepted: (step: EditingStep, index: number) => boolean): T {
  const next: Record<string, unknown> = { ...before };
  steps.forEach((step, index) => {
    if (!accepted(step, index)) return;
    if (step.to === undefined) delete next[step.key]; else next[step.key] = step.to;
  });
  return next as T;
}

// ---- Presence ------------------------------------------------------------------------------------------------------

/** One entry under presence/{project}/{uid} in Realtime Database. Overwritten as it moves; removed on disconnect. */
export interface PresenceEntry {
  name: string;
  kind: ParticipantKind;
  photoId?: string;
  x?: number;
  y?: number;
  at: number;
}

export interface Peer { uid: string; name: string; initials: string; kind: ParticipantKind; photoId: string | null; point: PhotoPoint | null }

/** An entry older than this is a connection that dropped without a clean disconnect: it is not shown. */
export const PRESENCE_STALE_MS = 2 * 60_000;

const KINDS: readonly ParticipantKind[] = ['human-editor', 'human-reviewer', 'anonymous-guest', 'tutorial-guide', 'copilot', 'autopilot'];
const unit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** Everyone else who is here now, in a stable order. Anything malformed is ignored rather than drawn. */
export function livePeers(entries: unknown, selfUid: string, nowMs: number): Peer[] {
  if (!entries || typeof entries !== 'object') return [];
  const peers: Peer[] = [];
  for (const [uid, raw] of Object.entries(entries as Record<string, unknown>)) {
    if (uid === selfUid || !raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<PresenceEntry>;
    if (typeof entry.name !== 'string' || !entry.name.trim() || !KINDS.includes(entry.kind as ParticipantKind)) continue;
    if (typeof entry.at !== 'number' || nowMs - entry.at > PRESENCE_STALE_MS) continue;
    const photoId = typeof entry.photoId === 'string' && entry.photoId ? entry.photoId : null;
    peers.push({
      uid, name: entry.name.trim().slice(0, 80), initials: initialsOf(entry.name), kind: entry.kind as ParticipantKind, photoId,
      point: photoId && unit(entry.x) && unit(entry.y) ? { x: entry.x, y: entry.y } : null,
    });
  }
  return peers.sort((a, b) => a.name.localeCompare(b.name, 'en-GB') || a.uid.localeCompare(b.uid));
}
