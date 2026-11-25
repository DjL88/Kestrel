/**
 * Build provenance (G10): which source commit a build came from, and whether the tree had changes in it.
 *
 * Every build (desktop, web, V2 site) stamps the same record into the UI (Settings → Build information) and writes it as
 * build-info.json in its output root, so a release check can compare what was actually built and served
 * (scripts/check-release-parity.mjs).
 *
 * Where the revision comes from:
 *   - the git checkout (`git rev-parse HEAD`, `git status --porcelain`), or
 *   - KESTREL_BUILD_REVISION (full 40-character SHA) when there is no .git, as in a Docker image build. If both exist
 *     they must agree, so a wrong build argument cannot relabel a build.
 *   - KESTREL_BUILD_DIRTY=1 marks an env-only build as changed (a container cannot see the host's tree).
 *
 * KESTREL_RELEASE=1 fails closed: a release build refuses to start when the revision is unknown or the tree is dirty.
 * Pure functions take their inputs so they can be unit tested; readGit is the only part that runs git.
 */
import { execFileSync } from 'node:child_process';

const FULL_SHA = /^[0-9a-f]{40}$/;

/** Untracked files only change a build when they sit where the build reads from. Notes and tool folders elsewhere do not. */
const BUILD_INPUTS = /^(?:src|public|src-tauri|crates|services|config)\/|^(?:index\.html|[^/]*\.config\.[cm]?[jt]s|package(?:-lock)?\.json)$/;

/**
 * Whether `git status --porcelain` output means the build differs from HEAD: any change to a tracked file, or an
 * untracked (not ignored) file under a build input.
 */
export function statusIsDirty(porcelain) {
  return porcelain.split(/\r?\n/).filter(Boolean).some((line) => {
    if (!line.startsWith('?? ')) return true;
    const path = line.slice(3).replace(/^"|"$/g, '');
    return BUILD_INPUTS.test(path);
  });
}

/** Ask git for HEAD and whether the tree differs from it (statusIsDirty). null when there is no checkout. */
export function readGit(cwd) {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { revision, dirty: statusIsDirty(status) };
  } catch {
    return null;
  }
}

/**
 * Decide the build's provenance. Throws (fails closed) when a release build's provenance is unknown or dirty, or when an
 * env-supplied revision is malformed or contradicts the checkout.
 * @param {{ env?: Record<string, string | undefined>, git?: { revision: string, dirty: boolean } | null, now?: Date, target: string }} input
 */
export function resolveProvenance({ env = {}, git = null, now = new Date(), target }) {
  const release = env.KESTREL_RELEASE === '1';
  const supplied = env.KESTREL_BUILD_REVISION?.trim().toLowerCase() || '';
  if (supplied && !FULL_SHA.test(supplied)) {
    throw new Error(`KESTREL_BUILD_REVISION must be a full 40-character commit SHA, not "${supplied}".`);
  }
  const gitRevision = git?.revision && FULL_SHA.test(git.revision) ? git.revision : '';
  if (supplied && gitRevision && supplied !== gitRevision) {
    throw new Error(`KESTREL_BUILD_REVISION (${supplied.slice(0, 12)}) does not match the checkout HEAD (${gitRevision.slice(0, 12)}).`);
  }
  const revision = gitRevision || supplied || null;
  const dirty = git ? git.dirty : env.KESTREL_BUILD_DIRTY === '1';
  const info = {
    schema: 1,
    target,
    revision,
    shortRevision: revision ? revision.slice(0, 12) : null,
    dirty,
    release,
    builtAt: now.toISOString(),
  };
  if (release) {
    const problems = releaseProblems(info);
    if (problems.length) throw new Error(`RELEASE BUILD BLOCKED (${target}): ${problems.join('; ')}.`);
  }
  return info;
}

/** Why a build record cannot be released. Empty when it can. */
export function releaseProblems(info) {
  const problems = [];
  if (!info || typeof info !== 'object') return ['no build information'];
  if (typeof info.revision !== 'string' || !FULL_SHA.test(info.revision)) problems.push('the source revision is unknown');
  if (info.dirty !== false) problems.push('the source tree had uncommitted changes');
  return problems;
}

/** Vite plugin: writes build-info.json into the output root. */
export function buildInfoPlugin(info) {
  return {
    name: 'kestrel-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(info, null, 2) + '\n' });
    },
  };
}

/** The `define` entries the UI reads (src/core/buildInfo.ts). */
export function buildInfoDefines(info) {
  return {
    'import.meta.env.VITE_KESTREL_BUILD_REVISION': JSON.stringify(info.shortRevision ?? 'unavailable'),
    'import.meta.env.VITE_KESTREL_BUILD_FULL_REVISION': JSON.stringify(info.revision ?? ''),
    'import.meta.env.VITE_KESTREL_BUILD_DIRTY': JSON.stringify(info.dirty ? 'true' : 'false'),
    'import.meta.env.VITE_KESTREL_BUILD_TIMESTAMP': JSON.stringify(info.builtAt),
  };
}
