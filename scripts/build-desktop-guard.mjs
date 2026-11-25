/** Release-only desktop build gate; intentionally pure for deterministic tests. */
export function assertReleaseBuildArgs(args) {
  for (const arg of args) {
    if (arg === '--debug' || arg.startsWith('--debug=') || arg === '-d') {
      throw new Error('Desktop installer must be an optimised release build (debug mode refused).');
    }
    if (arg === '--profile' || arg.startsWith('--profile=')) {
      throw new Error('Custom desktop build profiles are not verified release builds.');
    }
  }
}
export function assertChildSucceeded(result, step) {
  if (result.error) throw new Error(step + ' could not start: ' + result.error.message);
  if (result.signal) throw new Error(step + ' terminated by signal ' + result.signal);
  if (result.status !== 0) throw new Error(step + ' failed with exit status ' + String(result.status));
}

/**
 * Settings an installer for the owner must carry, or sign-in, Pro and the online helper quietly switch off (as happened
 * on 25 Nov 2026). All are public build settings read from .env.local / the environment, never secrets in the repo.
 */
export const RELEASE_ONLINE_SETTINGS = [
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID',
  'VITE_GOOGLE_SIGNIN_CLIENT_ID', 'VITE_KESTREL_SITE_URL', 'VITE_KESTREL_CONTROL_PLANE_URL', 'VITE_KESTREL_GRANT_KEYS',
];

/** Refuse a release build that is missing any of them, naming each one. */
export function assertReleaseOnlineSettings(env) {
  const missing = RELEASE_ONLINE_SETTINGS.filter((name) => typeof env[name] !== 'string' || env[name].trim() === '');
  if (missing.length) {
    throw new Error('Release build is missing online settings: ' + missing.join(', ') + '. Add them to .env.local (see .env.example and infra/gcp/README.md), or set KESTREL_RELEASE=0 for a local test build.');
  }
}
