import type { LastProject, LaunchProfile } from '../core/launchWelcome';
import { asSlideshowSnapshot, type SlideshowSnapshot } from '../core/welcomeSlideshow';
import { isDeviceKey } from '../v2/engineClient/eraseDeviceData';

/**
 * What the launch welcome remembers on this device. Read instantly at launch with no network.
 * Every key starts with `inflight.`, so "Forget me" (eraseDeviceData) removes it all.
 * Nothing here ever throws: private mode, quota or missing storage simply means "no memory".
 */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'>;
export type LaunchStorages = { local: StorageLike; session: StorageLike };

const PREFIX = 'inflight.launch.';
const KEY_PROFILE = `${PREFIX}profile`;
const KEY_LAST_PROJECT = `${PREFIX}lastProject`;
const KEY_LAUNCHED = `${PREFIX}launched`;
const KEY_SKIP = `${PREFIX}skip`;
const KEY_PROFILE_CHECKED = `${PREFIX}profileChecked`;
const KEY_SLIDESHOW = `${PREFIX}slideshow`;
const KEY_SLIDESHOW_OFF = `${PREFIX}slideshowOff`;

function defaults(): Partial<LaunchStorages> {
  const out: Partial<LaunchStorages> = {};
  try { if (typeof localStorage !== 'undefined') out.local = localStorage; } catch { /* unavailable */ }
  try { if (typeof sessionStorage !== 'undefined') out.session = sessionStorage; } catch { /* unavailable */ }
  return out;
}

function get(store: StorageLike | undefined, key: string): string | null {
  try { return store ? store.getItem(key) : null; } catch { return null; }
}
function set(store: StorageLike | undefined, key: string, value: string): void {
  try { store?.setItem(key, value); } catch { /* quota or private mode */ }
}
function remove(store: StorageLike | undefined, key: string): void {
  try { store?.removeItem(key); } catch { /* ignore */ }
}
function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function asProfile(value: unknown): LaunchProfile | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.signedIn !== true) return null;
  const text = (x: unknown) => (typeof x === 'string' ? x : null);
  if (v.displayName !== null && typeof v.displayName !== 'string') return null;
  if (v.initial !== null && typeof v.initial !== 'string') return null;
  return { signedIn: true, displayName: text(v.displayName), initial: text(v.initial) };
}

function asProject(value: unknown): LastProject | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.editedAt !== 'string') return null;
  if (typeof v.photoCount !== 'number' || !Number.isFinite(v.photoCount)) return null;
  return { id: v.id, name: v.name, photoCount: v.photoCount, editedAt: v.editedAt };
}

export function readProfile(s: Partial<LaunchStorages> = defaults()): LaunchProfile | null {
  return asProfile(parse(get(s.session, KEY_PROFILE))) ?? asProfile(parse(get(s.local, KEY_PROFILE)));
}

/** keep: survives restarts (local). Otherwise it lasts this browser session only. */
export function writeProfile(profile: LaunchProfile, keep: boolean, s: Partial<LaunchStorages> = defaults()): void {
  const json = JSON.stringify(profile);
  if (keep) { set(s.local, KEY_PROFILE, json); remove(s.session, KEY_PROFILE); }
  else { set(s.session, KEY_PROFILE, json); remove(s.local, KEY_PROFILE); }
}

export function clearProfile(s: Partial<LaunchStorages> = defaults()): void {
  remove(s.local, KEY_PROFILE);
  remove(s.session, KEY_PROFILE);
}

export function readLastProject(s: Partial<LaunchStorages> = defaults()): LastProject | null {
  return asProject(parse(get(s.local, KEY_LAST_PROJECT)));
}
export function writeLastProject(p: LastProject, s: Partial<LaunchStorages> = defaults()): void {
  set(s.local, KEY_LAST_PROJECT, JSON.stringify(p));
}

/**
 * A project was deleted (to Recently deleted or for good): the welcome must never offer it, or show its photos, at the
 * next launch. `stillHere` lists the projects that can still be opened; the remembered project and the slideshow are
 * forgotten when theirs is not among them.
 */
export function forgetLaunchProjectsExcept(stillHere: readonly string[], s: Partial<LaunchStorages> = defaults()): void {
  const last = readLastProject(s);
  if (last && !stillHere.includes(last.id)) remove(s.local, KEY_LAST_PROJECT);
  const slideshow = readSlideshow(s);
  if (slideshow && !stillHere.includes(slideshow.projectId)) remove(s.local, KEY_SLIDESHOW);
}
/** The same for one project that has just gone. */
export function forgetLaunchProject(id: string, s: Partial<LaunchStorages> = defaults()): void {
  if (readLastProject(s)?.id === id) remove(s.local, KEY_LAST_PROJECT);
  if (readSlideshow(s)?.projectId === id) remove(s.local, KEY_SLIDESHOW);
}

export function markLaunched(s: Partial<LaunchStorages> = defaults()): void { set(s.local, KEY_LAUNCHED, '1'); }
export function launchedBefore(s: Partial<LaunchStorages> = defaults()): boolean { return get(s.local, KEY_LAUNCHED) === '1'; }

export function skipChosen(s: Partial<LaunchStorages> = defaults()): boolean { return get(s.local, KEY_SKIP) === '1'; }
export function setSkipChosen(skip: boolean, s: Partial<LaunchStorages> = defaults()): void {
  if (skip) set(s.local, KEY_SKIP, '1'); else remove(s.local, KEY_SKIP);
}

export function profileChecked(s: Partial<LaunchStorages> = defaults()): boolean { return get(s.local, KEY_PROFILE_CHECKED) === '1'; }
export function markProfileChecked(s: Partial<LaunchStorages> = defaults()): void { set(s.local, KEY_PROFILE_CHECKED, '1'); }

/**
 * The welcome-back slideshow: references to up to eight previews already stored on this device (never the pictures),
 * written while a project is open. Null forgets it (no flagged photos in the project now open).
 */
export function readSlideshow(s: Partial<LaunchStorages> = defaults()): SlideshowSnapshot | null {
  return asSlideshowSnapshot(parse(get(s.local, KEY_SLIDESHOW)));
}
export function writeSlideshow(snapshot: SlideshowSnapshot | null, s: Partial<LaunchStorages> = defaults()): void {
  if (snapshot && snapshot.keys.length > 0) set(s.local, KEY_SLIDESHOW, JSON.stringify(snapshot)); else remove(s.local, KEY_SLIDESHOW);
}

/** The Settings switch "Show my photos on the welcome screen": on unless turned off. */
export function slideshowOff(s: Partial<LaunchStorages> = defaults()): boolean { return get(s.local, KEY_SLIDESHOW_OFF) === '1'; }
export function setSlideshowOff(off: boolean, s: Partial<LaunchStorages> = defaults()): void {
  if (off) set(s.local, KEY_SLIDESHOW_OFF, '1'); else remove(s.local, KEY_SLIDESHOW_OFF);
}

/** Someone upgrading has theme, layout or V2 keys already, so they count as returning. */
export function priorUseDetected(s: Partial<LaunchStorages> = defaults()): boolean {
  const store = s.local;
  if (!store) return false;
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && isDeviceKey(key) && !key.startsWith(PREFIX)) return true;
    }
  } catch { /* unreadable storage counts as no prior use */ }
  return false;
}
