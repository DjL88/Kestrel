/** Safe, public release announcements for installed macOS / Windows builds.
 *
 * This is NOT an updater. It never downloads, executes, or installs software.
 * Signed, tested Tauri updates remain a separate opt-in feature.
 */
type Version = readonly [number, number, number];
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

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
