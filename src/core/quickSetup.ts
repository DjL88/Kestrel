/**
 * Quick setup at first run (V2): language, a few words about how the person shoots, Pro, cloud, Flight mode and the
 * optional AI extras. It is never a gate: every step can be skipped, "Skip setup" is always there, and it can be run
 * again from Settings. The answers live on this device and, once signed in, on the account (so another device or a
 * fresh sign-in applies them instead of asking again). Pure: no DOM, storage or network.
 */
import { isLanguageCode, type LanguageCode } from './locale';

export type SetupStep = 'language' | 'about' | 'pro' | 'cloud' | 'flight' | 'extras';
/** In the owner's order, with the two quick questions straight after the language so later steps can be tailored. */
export const SETUP_STEPS: readonly SetupStep[] = ['language', 'about', 'pro', 'cloud', 'flight', 'extras'];

export type SetupGenre = 'wildlife' | 'sport' | 'aviation' | 'weddings' | 'portraits' | 'landscape' | 'everyday';
export const SETUP_GENRES: readonly SetupGenre[] = ['wildlife', 'sport', 'aviation', 'weddings', 'portraits', 'landscape', 'everyday'];
export type SetupExperience = 'new' | 'some' | 'pro';
export const SETUP_EXPERIENCE: readonly SetupExperience[] = ['new', 'some', 'pro'];
export type SetupFlightMode = 'solo' | 'copilot' | 'autopilot';
const FLIGHT_MODES: readonly SetupFlightMode[] = ['solo', 'copilot', 'autopilot'];
export type SetupCloud = 'local' | 'account';

export interface SetupAnswers {
  language?: LanguageCode;
  genres?: SetupGenre[];
  experience?: SetupExperience;
  cloud?: SetupCloud;
  flightMode?: SetupFlightMode;
  /** 'done': finished; 'skipped': the person chose Skip setup. Either way it is not offered again by itself. */
  status: 'in-progress' | 'done' | 'skipped';
  /** Where to carry on (after the language step restarts the app in the new language). */
  step?: SetupStep;
  /** ISO time it was finished or skipped; the newer of two copies wins. */
  updatedAt?: string;
}

const str = (value: unknown): value is string => typeof value === 'string';

/** Read defensively: anything unknown is dropped, so a damaged or newer record never breaks the welcome. */
export function parseSetupAnswers(value: unknown): SetupAnswers | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.status !== 'in-progress' && v.status !== 'done' && v.status !== 'skipped') return null;
  const out: SetupAnswers = { status: v.status };
  if (isLanguageCode(v.language)) out.language = v.language;
  if (Array.isArray(v.genres)) {
    const genres = SETUP_GENRES.filter((g) => (v.genres as unknown[]).includes(g));
    out.genres = genres;
  }
  if ((SETUP_EXPERIENCE as readonly unknown[]).includes(v.experience)) out.experience = v.experience as SetupExperience;
  if (v.cloud === 'local' || v.cloud === 'account') out.cloud = v.cloud;
  if ((FLIGHT_MODES as readonly unknown[]).includes(v.flightMode)) out.flightMode = v.flightMode as SetupFlightMode;
  if ((SETUP_STEPS as readonly unknown[]).includes(v.step)) out.step = v.step as SetupStep;
  if (str(v.updatedAt) && !Number.isNaN(Date.parse(v.updatedAt))) out.updatedAt = v.updatedAt;
  return out;
}

export function setupFinished(answers: SetupAnswers | null): boolean {
  return answers?.status === 'done' || answers?.status === 'skipped';
}

export function nextStep(step: SetupStep): SetupStep | null {
  const at = SETUP_STEPS.indexOf(step);
  return at >= 0 && at < SETUP_STEPS.length - 1 ? SETUP_STEPS[at + 1] : null;
}
export function previousStep(step: SetupStep): SetupStep | null {
  const at = SETUP_STEPS.indexOf(step);
  return at > 0 ? SETUP_STEPS[at - 1] : null;
}

/**
 * The Flight mode suggested by the answers: someone new gets Co-pilot (suggestions they accept or not), an experienced
 * photographer gets Solo, and a high-volume event shooter who is not new gets Auto-pilot. Nothing is chosen for them:
 * the step only starts on this one.
 */
export function suggestedFlightMode(answers: Pick<SetupAnswers, 'experience' | 'genres'>): SetupFlightMode {
  if (answers.experience === 'pro') return 'solo';
  const volume = answers.genres?.some((g) => g === 'weddings' || g === 'sport') ?? false;
  if (answers.experience === 'some' && volume) return 'autopilot';
  return 'copilot';
}

/** The interface settings the answers tailor. Only those two, and only from the experience answer. */
export function tailoredSettings(answers: Pick<SetupAnswers, 'experience'>): { advancedControls?: boolean; calmHints?: boolean } {
  if (answers.experience === 'new') return { advancedControls: false, calmHints: false };
  if (answers.experience === 'pro') return { advancedControls: true };
  return {};
}

/**
 * Which optional AI extras to tick to begin with, by what the person shoots. Roles are the model catalogue's. Nothing
 * downloads until they press Download; unticked ones stay in Settings → Models.
 */
export function suggestedExtras(genres: readonly SetupGenre[] | undefined): string[] {
  const roles = new Set<string>();
  for (const genre of genres ?? []) {
    if (genre === 'wildlife') { roles.add('speciesCheck'); roles.add('detectorTandem'); roles.add('tapSelect'); }
    if (genre === 'sport' || genre === 'aviation') { roles.add('detectorTandem'); roles.add('tapSelect'); }
    if (genre === 'weddings' || genre === 'portraits') { roles.add('fineEdges'); roles.add('tapSelect'); roles.add('denoise'); }
    if (genre === 'landscape') roles.add('denoise');
    if (genre === 'everyday') roles.add('tapSelect');
  }
  return [...roles];
}

/** The catalogue names two roles differently while the plain-name rename lands; both mean the same extra here. */
export function extraKey(role: string): string {
  if (role === 'species') return 'speciesCheck';
  if (role === 'mask') return 'fineEdges';
  return role;
}

/**
 * Which copy to keep when this device and the account both have answers. A finished copy beats one in progress, and
 * between two finished copies the newer wins. Returns 'account' when the account's copy should be applied here,
 * 'device' when this device's copy should be saved to the account, and 'same' when nothing needs to move.
 */
export function reconcileSetup(device: SetupAnswers | null, account: SetupAnswers | null): 'account' | 'device' | 'same' {
  const deviceDone = setupFinished(device);
  const accountDone = setupFinished(account);
  if (accountDone && !deviceDone) return 'account';
  if (deviceDone && !accountDone) return 'device';
  if (!deviceDone && !accountDone) return 'same';
  const d = Date.parse(device?.updatedAt ?? '') || 0;
  const a = Date.parse(account?.updatedAt ?? '') || 0;
  return a > d ? 'account' : d > a ? 'device' : 'same';
}

/** What is saved to the account: the answers only, never where the person got to or anything about photos. */
export function accountCopy(answers: SetupAnswers): SetupAnswers {
  const { step: _step, ...rest } = answers;
  return rest;
}
