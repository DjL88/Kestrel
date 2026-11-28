/**
 * Publish to V2Proto (owner decision, 28 Nov 2026): the private /V2Proto preview is updated only when the owner presses a
 * button in /admin, no longer on every merge to main.
 *
 * This module can do exactly one thing to the outside world: ask Cloud Build to run the V2Proto trigger for one commit
 * (`.cloudbuild/v2proto.yaml`). The trigger id must start `inflight-v2proto-`, so a mistyped setting can never aim it at
 * the public website, the downloads bucket, the control plane, the updater or a store. Before it asks, the commit must be
 * a full 40-character SHA, be on `main`, and have a green CI `check`. Reads of GitHub need a read-only token that lives in
 * Secret Manager, never in the repository or the logs.
 */

export type CiState = 'green' | 'red' | 'pending' | 'unknown';
export type BuildState = 'queued' | 'building' | 'done' | 'failed' | 'unknown';

export interface MainCommit { sha: string; message: string; committedAtMs: number; ci: CiState }

/** Reads the repository. Production: GitHub's REST API with a read-only token. */
export interface CommitSource {
  recentMain(limit: number): Promise<MainCommit[]>;
  /** The commit as the repository knows it, or null when it is not on `main`. */
  onMain(sha: string): Promise<{ message: string; committedAtMs: number } | null>;
  ci(sha: string): Promise<CiState>;
}

/** Starts and reads V2Proto builds. Production: Cloud Build's REST API. */
export interface BuildHost {
  start(sha: string): Promise<{ buildId: string }>;
  status(buildId: string): Promise<{ state: BuildState; reason?: string; logUrl?: string }>;
}

export interface PublishRecord {
  sha: string; message: string; atMs: number; by: string; buildId: string;
  state: BuildState; reason?: string; logUrl?: string;
  /** When the build was last seen finished (done or failed). */
  finishedAtMs?: number;
}

export class PublishRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export const V2PROTO_TRIGGER_PATTERN = /^inflight-v2proto-[a-z0-9-]{1,40}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SETTING = 'v2proto_last_publish';
/** A build that has shown no progress for this long no longer blocks the next publish. */
const STALE_MS = 60 * 60_000;

export interface PublisherDeps {
  source: CommitSource;
  builds: BuildHost;
  state: { get(name: string): Promise<string | undefined>; set(name: string, value: string): Promise<void> };
  now: () => number;
}

export class V2ProtoPublisher {
  constructor(private readonly d: PublisherDeps) {}

  private async load(): Promise<PublishRecord | null> {
    try { const raw = await this.d.state.get(SETTING); return raw ? JSON.parse(raw) as PublishRecord : null; } catch { return null; }
  }

  /** The last publish, with a running build's state refreshed from Cloud Build. A Cloud Build outage leaves the old answer. */
  async last(): Promise<PublishRecord | null> {
    const rec = await this.load();
    if (!rec || (rec.state !== 'queued' && rec.state !== 'building' && rec.state !== 'unknown') || rec.finishedAtMs) return rec;
    try {
      const s = await this.d.builds.status(rec.buildId);
      const next: PublishRecord = { ...rec, state: s.state, reason: s.reason, logUrl: s.logUrl, finishedAtMs: s.state === 'done' || s.state === 'failed' ? this.d.now() : undefined };
      await this.d.state.set(SETTING, JSON.stringify(next));
      return next;
    } catch { return rec; }
  }

  async overview(limit = 15): Promise<{ commits: MainCommit[]; latestGreenSha: string | null; last: PublishRecord | null }> {
    const [commits, last] = await Promise.all([this.d.source.recentMain(Math.max(1, Math.min(30, limit))), this.last()]);
    return { commits, latestGreenSha: commits.find((c) => c.ci === 'green')?.sha ?? null, last };
  }

  /** Validate, then start the V2Proto build for exactly this commit. `confirmedSha` is what the owner saw in the question. */
  async publish(sha: string, confirmedSha: string, by: string): Promise<PublishRecord> {
    if (!SHA_PATTERN.test(sha)) throw new PublishRefusal(400, 'V2PROTO_BAD_SHA', 'Give the full 40-character commit id.');
    if (confirmedSha !== sha) throw new PublishRefusal(400, 'V2PROTO_NOT_CONFIRMED', 'The confirmation does not match the commit. Nothing was published.');
    const commit = await this.d.source.onMain(sha);
    if (!commit) throw new PublishRefusal(409, 'V2PROTO_NOT_ON_MAIN', 'That commit is not on main, so it cannot go to V2Proto.');
    const ci = await this.d.source.ci(sha);
    if (ci !== 'green') throw new PublishRefusal(409, 'V2PROTO_CI_NOT_GREEN', ci === 'pending' ? 'The checks on that commit are still running. Try again when they are green.' : ci === 'red' ? 'The checks on that commit failed, so it cannot go to V2Proto.' : 'There is no finished check for that commit, so it cannot go to V2Proto.');
    const current = await this.last();
    if (current && (current.state === 'queued' || current.state === 'building') && this.d.now() - current.atMs < STALE_MS) {
      throw new PublishRefusal(409, 'V2PROTO_BUSY', 'A V2Proto build is already running. Wait for it to finish.');
    }
    let buildId: string;
    try { buildId = (await this.d.builds.start(sha)).buildId; } catch {
      throw new PublishRefusal(502, 'V2PROTO_BUILD_NOT_STARTED', 'Cloud Build did not start the build. Nothing was published.');
    }
    const record: PublishRecord = { sha, message: commit.message, atMs: this.d.now(), by, buildId, state: 'queued' };
    await this.d.state.set(SETTING, JSON.stringify(record));
    return record;
  }
}

// ---- GitHub (read only) -------------------------------------------------------------------------------------------

/** `owner/name`, exactly. */
export const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,60}\/[A-Za-z0-9_.-]{1,100}$/;

interface CheckRun { name: string; status: string; conclusion: string | null; started_at?: string | null }

export function ciFromRuns(runs: CheckRun[]): CiState {
  const checks = runs.filter((r) => r.name === 'check').sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));
  const latest = checks[0];
  if (!latest) return 'unknown';
  if (latest.status !== 'completed') return 'pending';
  return latest.conclusion === 'success' ? 'green' : 'red';
}

export function githubSource(repo: string, token: () => Promise<string>, fetcher: typeof fetch = fetch): CommitSource {
  if (!REPO_PATTERN.test(repo)) throw new Error('KCP_V2PROTO_REPO must be owner/name');
  const get = async (path: string) => fetcher(`https://api.github.com/repos/${repo}${path}`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${await token()}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'inflight-control-plane' },
  });
  const ci = async (sha: string): Promise<CiState> => {
    const r = await get(`/commits/${sha}/check-runs?check_name=check&per_page=10`);
    if (!r.ok) return 'unknown';
    return ciFromRuns(((await r.json()) as { check_runs?: CheckRun[] }).check_runs ?? []);
  };
  const first = (m: string) => m.split('\n')[0].slice(0, 200);
  return {
    ci,
    async recentMain(limit) {
      const r = await get(`/commits?sha=main&per_page=${limit}`);
      if (!r.ok) throw new Error(`github ${r.status}`);
      const list = (await r.json()) as { sha: string; commit: { message: string; committer?: { date?: string } } }[];
      return Promise.all(list.map(async (c) => ({ sha: c.sha, message: first(c.commit.message), committedAtMs: Date.parse(c.commit.committer?.date ?? '') || 0, ci: await ci(c.sha) })));
    },
    async onMain(sha) {
      const r = await get(`/compare/${sha}...main`);
      if (!r.ok) return null;
      // Compared from the commit to main: 'ahead' (main has moved on) or 'identical' means the commit is part of main.
      const c = (await r.json()) as { status?: string; base_commit?: { commit: { message: string; committer?: { date?: string } } } };
      if (c.status !== 'ahead' && c.status !== 'identical') return null;
      const base = c.base_commit?.commit;
      return { message: first(base?.message ?? ''), committedAtMs: Date.parse(base?.committer?.date ?? '') || 0 };
    },
  };
}

// ---- Cloud Build --------------------------------------------------------------------------------------------------

const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

const FAILURE_WORDS: Record<string, string> = {
  FAILURE: 'The build ran but a step failed. The Cloud Build log says which.',
  INTERNAL_ERROR: 'Cloud Build had a problem of its own. Try again.',
  TIMEOUT: 'The build took too long and was stopped.',
  CANCELLED: 'The build was cancelled.',
  EXPIRED: 'The build waited too long to start and was dropped.',
};

export function cloudBuildHost(cfg: { project: string; triggerId: string; location?: string }, token: () => Promise<string>, fetcher: typeof fetch = fetch): BuildHost {
  if (!PROJECT_PATTERN.test(cfg.project)) throw new Error('KCP_V2PROTO_PROJECT is not a project id');
  if (!V2PROTO_TRIGGER_PATTERN.test(cfg.triggerId)) throw new Error('KCP_V2PROTO_TRIGGER_ID must start inflight-v2proto-: this can only start the V2Proto build');
  const location = cfg.location ?? 'global';
  const base = `https://cloudbuild.googleapis.com/v1/projects/${cfg.project}/locations/${location}`;
  const headers = async () => ({ 'content-type': 'application/json', authorization: `Bearer ${await token()}` });
  return {
    async start(sha) {
      const r = await fetcher(`${base}/triggers/${cfg.triggerId}:run`, {
        method: 'POST', headers: await headers(),
        body: JSON.stringify({ source: { branchName: 'main', commitSha: sha } }),
      });
      if (!r.ok) throw new Error(`cloud build ${r.status}`);
      const op = (await r.json()) as { metadata?: { build?: { id?: string } } };
      const id = op.metadata?.build?.id;
      if (!id || !/^[0-9a-f-]{20,64}$/.test(id)) throw new Error('cloud build gave no build id');
      return { buildId: id };
    },
    async status(buildId) {
      if (!/^[0-9a-f-]{20,64}$/.test(buildId)) return { state: 'unknown' };
      const r = await fetcher(`${base}/builds/${buildId}`, { headers: await headers() });
      if (!r.ok) throw new Error(`cloud build ${r.status}`);
      const b = (await r.json()) as { status?: string; logUrl?: string };
      const logUrl = b.logUrl?.startsWith('https://console.cloud.google.com/') ? b.logUrl : undefined;
      switch (b.status) {
        case 'QUEUED': case 'PENDING': return { state: 'queued', logUrl };
        case 'WORKING': return { state: 'building', logUrl };
        case 'SUCCESS': return { state: 'done', logUrl };
        case 'FAILURE': case 'INTERNAL_ERROR': case 'TIMEOUT': case 'CANCELLED': case 'EXPIRED': return { state: 'failed', reason: FAILURE_WORDS[b.status], logUrl };
        default: return { state: 'unknown' };
      }
    },
  };
}
