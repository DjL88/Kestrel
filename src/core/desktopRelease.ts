/** Safe, public release announcements for installed macOS / Windows builds.
 *
 * This is NOT an updater. It never downloads, executes, or installs software.
 * Signed, tested Tauri updates remain a separate opt-in feature.
 */
export interface DesktopReleaseNotice {
  version: string;
  url: string;
  publishedAt: string;
}

type Version = readonly [number, number, number];
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
const RELEASES_PATH = 'https://github.com/DjL88/Kestrel/releases/tag/';

function parseVersion(value: string): Version | null {
  const matched = VERSION.exec(value);
  if (!matched) return null;
  const parts = matched.slice(1).map(Number);
  return parts.length === 3 && parts.every(Number.isSafeInteger)
    ? [parts[0], parts[1], parts[2]]
    : null;
}

export function newerRelease(candidate: string, installed: string): boolean {
  const remote = parseVersion(candidate);
  const local = parseVersion(installed);
  if (!remote || !local) return false;
  for (let index = 0; index < 3; index++) {
    if (remote[index] !== local[index]) return remote[index] > local[index];
  }
  return false;
}

/** A Tauri window is not necessarily a desktop: iOS/Android also use Tauri. */
export function desktopReleasePlatform(
  userAgent: string, maxTouchPoints = 0,
): 'macos' | 'windows' | null {
  if (/Windows NT/i.test(userAgent)) return 'windows';
  // iPadOS can advertise the Mac desktop user agent, but store apps update
  // through the App Store. Reject a Mac-like touch-capable iPad user agent.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints < 2) return 'macos';
  return null;
}

/**
 * Strictly validate an unauthenticated GitHub latest-release response before
 * showing an action. Never open an arbitrary URL supplied by a public API.
 */
export function publishedDesktopRelease(
  data: unknown, installedVersion: string,
): DesktopReleaseNotice | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const release = data as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false ||
      typeof release.tag_name !== 'string' ||
      typeof release.html_url !== 'string' ||
      typeof release.published_at !== 'string') return null;
  if (!newerRelease(release.tag_name, installedVersion)) return null;
  if (!Number.isFinite(Date.parse(release.published_at))) return null;
  const canonicalUrl = RELEASES_PATH + release.tag_name;
  if (release.html_url !== canonicalUrl) return null;
  const parsed = parseVersion(release.tag_name);
  if (!parsed) return null;
  return { version: parsed.join('.'), url: canonicalUrl, publishedAt: release.published_at };
}
