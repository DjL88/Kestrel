/**
 * What Settings → Build information shows (G10). The values are stamped at build time by scripts/build-provenance.mjs,
 * which also writes the same record to build-info.json for the release parity check.
 */
export interface BuildInfo {
  /** First 12 characters of the commit, or null when the build could not tell. */
  revision: string | null;
  /** The full 40-character commit, or null. */
  fullRevision: string | null;
  /** True when the build came from a tree with changes not in that commit. Release builds refuse that. */
  modified: boolean;
  /** ISO time of the build, or null. */
  builtAt: string | null;
}

interface StampedEnv {
  VITE_KESTREL_BUILD_REVISION?: string;
  VITE_KESTREL_BUILD_FULL_REVISION?: string;
  VITE_KESTREL_BUILD_DIRTY?: string;
  VITE_KESTREL_BUILD_TIMESTAMP?: string;
}

const SHORT = /^[0-9a-f]{7,40}$/;
const FULL = /^[0-9a-f]{40}$/;

/** Reads the stamped values without trusting them: anything malformed shows as unavailable, never as a made-up commit. */
export function readBuildInfo(env: StampedEnv): BuildInfo {
  const full = env.VITE_KESTREL_BUILD_FULL_REVISION?.trim().toLowerCase() ?? '';
  const short = env.VITE_KESTREL_BUILD_REVISION?.trim().toLowerCase() ?? '';
  const fullRevision = FULL.test(full) ? full : null;
  const revision = fullRevision ? fullRevision.slice(0, 12) : SHORT.test(short) ? short : null;
  const stamp = env.VITE_KESTREL_BUILD_TIMESTAMP?.trim() ?? '';
  const builtAt = stamp && !Number.isNaN(Date.parse(stamp)) ? stamp : null;
  return { revision, fullRevision, modified: env.VITE_KESTREL_BUILD_DIRTY === 'true', builtAt };
}
