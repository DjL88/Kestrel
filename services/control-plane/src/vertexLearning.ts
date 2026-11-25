/**
 * Vertex AI learning from consented shadow files, in batches only (owner decisions 7 and 9, 25 Nov 2026).
 *
 * One hourly tick (Cloud Scheduler → Cloud Run job `runVertexLearning.ts`) decides whether to start a training run.
 * A run starts on whichever comes first:
 *   (a) `photoThreshold` newly edited photos from opted-in people since the last run (default 1,000, one setting);
 *   (b) a week since the last run or weekly check, skipped when nothing new has arrived;
 *   (c) "Learn now" in /admin.
 *
 * HARD SPEND GUARD. Budgets only alert, so before any run the tick reserves the run's WORST-CASE cost (price per hour of
 * the machine × the run's hard time limit, which Vertex enforces with `scheduling.timeout`) in a Firestore month record,
 * inside one transaction, and refuses when the month's reservations would pass the ceiling. The ceiling can be lowered
 * by setting but never raised above APPROVED_MONTHLY_PENCE (the owner's £20 approval) without a code change. A
 * reservation is released only when the job was never accepted by Vertex; a run that started keeps its full
 * reservation, so the guard never under-counts.
 *
 * NO ALWAYS-ON ENDPOINTS. This module only creates and reads CustomJobs (batch training that stops by itself). It never
 * creates, deploys to or calls an endpoint, and every tick refuses to start a run while any endpoint in the region has a
 * deployed model. Trained models come back to devices as signed ONNX packs through the existing manifest.
 *
 * Only derived shadow files are used (kite44ResearchLedger.ts): no photo, preview, file name or EXIF is ever read here.
 */
import { uuid } from './crypto.ts';
import type { FirestoreLike, FsTransaction } from './firestoreStore.ts';

/** The owner's approval: £20 a month of Vertex AI (25 Nov 2026). Raising it needs the owner and a code change. */
export const APPROVED_MONTHLY_PENCE = 2000;
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

export interface VertexLearningConfig {
  /** Newly edited photos since the last run that start a run on their own (owner setting, default 1,000). */
  photoThreshold: number;
  /** Monthly ceiling in pence, at most APPROVED_MONTHLY_PENCE. */
  ceilingPence: number;
  /** List price per hour of the training machine, in pence (e2-standard-4 in London, 25 Nov 2026: about 17p). */
  pencePerHour: number;
  /** Hard time limit of one run, in hours; Vertex stops the job at this point. */
  maxRunHours: number;
  region: string;
  machineType: string;
}

export const DEFAULT_CONFIG: VertexLearningConfig = {
  photoThreshold: 1000, ceilingPence: APPROVED_MONTHLY_PENCE, pencePerHour: 17, maxRunHours: 2,
  region: 'europe-west2', machineType: 'e2-standard-4',
};

/** Worst-case cost of one run: the machine price for the whole time limit, rounded up. */
export const reservationPence = (c: Pick<VertexLearningConfig, 'pencePerHour' | 'maxRunHours'>) => Math.ceil(c.pencePerHour * c.maxRunHours);

export function checkConfig(c: VertexLearningConfig): VertexLearningConfig {
  const whole = (n: number, lo: number, hi: number, name: string) => {
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${name} must be a whole number from ${lo} to ${hi}`);
  };
  whole(c.photoThreshold, 1, 10_000_000, 'photoThreshold');
  whole(c.ceilingPence, 0, APPROVED_MONTHLY_PENCE, 'ceilingPence');
  whole(c.pencePerHour, 1, 100_000, 'pencePerHour');
  whole(c.maxRunHours, 1, 24, 'maxRunHours');
  if (!/^[a-z]+-[a-z]+\d+$/.test(c.region)) throw new Error('region must be a Google Cloud region such as europe-west2');
  if (!/^[a-z0-9]+-[a-z0-9-]+$/.test(c.machineType)) throw new Error('machineType must be a machine type such as e2-standard-4');
  return c;
}

export function configFromEnv(env: NodeJS.ProcessEnv): VertexLearningConfig {
  const num = (name: string, dflt: number) => (env[name] === undefined || env[name] === '' ? dflt : Number(env[name]));
  return checkConfig({
    photoThreshold: num('KCP_VERTEX_PHOTO_THRESHOLD', DEFAULT_CONFIG.photoThreshold),
    ceilingPence: num('KCP_VERTEX_CEILING_PENCE', DEFAULT_CONFIG.ceilingPence),
    pencePerHour: num('KCP_VERTEX_PENCE_PER_HOUR', DEFAULT_CONFIG.pencePerHour),
    maxRunHours: num('KCP_VERTEX_MAX_RUN_HOURS', DEFAULT_CONFIG.maxRunHours),
    region: env.KCP_VERTEX_REGION || DEFAULT_CONFIG.region,
    machineType: env.KCP_VERTEX_MACHINE_TYPE || DEFAULT_CONFIG.machineType,
  });
}

export type Trigger = 'manual' | 'count' | 'weekly';
export type SkipReason =
  | 'switched-off' | 'trainer-not-set-up' | 'endpoint-deployed' | 'run-in-progress' | 'nothing-due' | 'nothing-new' | 'ceiling';

export interface LearningState {
  /** Bumped by every run; photos are counted once per generation. */
  generation: number;
  newPhotos: number;
  lastRunAtMs: number | null;
  /** Last time the weekly trigger was considered (a run or a skipped empty week). */
  lastWeeklyAtMs: number | null;
  manualRequestedAtMs: number | null;
  runningRunId: string | null;
  runningSinceMs: number | null;
}

export const EMPTY_STATE: LearningState = {
  generation: 0, newPhotos: 0, lastRunAtMs: null, lastWeeklyAtMs: null, manualRequestedAtMs: null, runningRunId: null, runningSinceMs: null,
};

export type Decision =
  | { run: true; trigger: Trigger; reservePence: number }
  | { run: false; reason: SkipReason; trigger?: Trigger; weeklyChecked?: boolean };

/**
 * Pure decision for one tick. `monthReservedPence` is what this calendar month has already reserved.
 * A run still inside its time limit (plus an hour's grace) blocks another; after that Vertex has stopped it anyway.
 */
export function decide(state: LearningState, nowMs: number, monthReservedPence: number, c: VertexLearningConfig): Decision {
  if (state.runningRunId && state.runningSinceMs !== null && nowMs - state.runningSinceMs < (c.maxRunHours + 1) * HOUR_MS) {
    return { run: false, reason: 'run-in-progress' };
  }
  // The weekly clock starts at the first tick (claim() records it), so a fresh install does not run at once.
  const weeklyFrom = state.lastWeeklyAtMs ?? state.lastRunAtMs;
  const weeklyDue = weeklyFrom !== null && nowMs - weeklyFrom >= WEEK_MS;
  const trigger: Trigger | undefined = state.manualRequestedAtMs !== null ? 'manual'
    : state.newPhotos >= c.photoThreshold ? 'count'
      : weeklyDue ? 'weekly' : undefined;
  if (!trigger) return { run: false, reason: 'nothing-due' };
  if (state.newPhotos === 0) return { run: false, reason: 'nothing-new', trigger, weeklyChecked: trigger === 'weekly' };
  const reservePence = reservationPence(c);
  if (monthReservedPence + reservePence > Math.min(c.ceilingPence, APPROVED_MONTHLY_PENCE)) return { run: false, reason: 'ceiling', trigger };
  return { run: true, trigger, reservePence };
}

/**
 * The UTC calendar month. Google's invoice month uses Pacific time, so a run in the first or last hours of a month may
 * land in the other month's bill; the ceiling is per month on our own records, which never under-count a run.
 */
export const billingMonth = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 7);

export interface RunRecord {
  runId: string; month: string; trigger: Trigger; reservedPence: number; newPhotos: number; generation: number;
  status: 'reserved' | 'submitted' | 'succeeded' | 'failed' | 'not-started'; startedAtMs: number; customJob?: string; finishedAtMs?: number;
}

const COL = { state: 'vertex_learning_state', months: 'vertex_learning_months', runs: 'vertex_learning_runs', pending: 'vertex_learning_pending' } as const;
const STATE_ID = 'current';

function readState(data: Record<string, unknown> | undefined): LearningState {
  return { ...EMPTY_STATE, ...(data as Partial<LearningState> | undefined) };
}

/** Firestore records for the batch trigger and the spend guard. All changes happen in transactions. */
export class VertexLearningLedger {
  constructor(private readonly db: FirestoreLike) {}
  private stateRef() { return this.db.collection(COL.state).doc(STATE_ID); }
  private monthRef(month: string) { return this.db.collection(COL.months).doc(month); }

  async state(): Promise<LearningState> { return readState((await this.stateRef().get()).data()); }
  async monthReservedPence(month: string): Promise<number> { return Number((await this.monthRef(month).get()).data()?.reservedPence ?? 0); }

  /**
   * Count one newly edited photo, once per run generation. Call inside the transaction that stores its shadow file
   * (all reads first, as Firestore requires): `const n = await ledger.prepareCount(tx, photoKey); ...writes...; n.commit()`.
   */
  async prepareCount(tx: FsTransaction, photoKey: string): Promise<{ commit(): void }> {
    const stateRef = this.stateRef();
    const state = readState((await tx.get(stateRef)).data());
    const marker = this.db.collection(COL.pending).doc(`${state.generation}|${photoKey}`);
    const seen = (await tx.get(marker)).exists;
    return {
      commit: () => {
        if (seen) return;
        tx.create(marker, { generation: state.generation });
        tx.set(stateRef, { ...state, newPhotos: state.newPhotos + 1 });
      },
    };
  }

  /** "Learn now" from /admin: picked up by the next tick, or at once when the control plane starts the job. */
  async requestManualRun(nowMs: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.stateRef();
      const state = readState((await tx.get(ref)).data());
      tx.set(ref, { ...state, manualRequestedAtMs: state.manualRequestedAtMs ?? nowMs });
    });
  }

  /** Decide and, when a run is due and affordable, reserve its worst-case cost and claim it, in one transaction. */
  async claim(nowMs: number, c: VertexLearningConfig): Promise<{ decision: Decision; run?: RunRecord }> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.stateRef();
      const month = billingMonth(nowMs);
      const mref = this.monthRef(month);
      const [s, m] = await Promise.all([tx.get(ref), tx.get(mref)]);
      const state = readState(s.data());
      const reserved = Number(m.data()?.reservedPence ?? 0);
      const decision = decide(state, nowMs, reserved, c);
      if (!decision.run) {
        if (decision.weeklyChecked || (state.lastWeeklyAtMs === null && state.lastRunAtMs === null)) tx.set(ref, { ...state, lastWeeklyAtMs: nowMs });
        else if (decision.reason === 'nothing-new' && decision.trigger === 'manual') tx.set(ref, { ...state, manualRequestedAtMs: null });
        return { decision };
      }
      const run: RunRecord = {
        runId: uuid(), month, trigger: decision.trigger, reservedPence: decision.reservePence, newPhotos: state.newPhotos,
        generation: state.generation, status: 'reserved', startedAtMs: nowMs,
      };
      tx.set(mref, { month, reservedPence: reserved + decision.reservePence });
      tx.create(this.db.collection(COL.runs).doc(run.runId), { ...run });
      tx.set(ref, {
        ...state, generation: state.generation + 1, newPhotos: 0, lastRunAtMs: nowMs, lastWeeklyAtMs: nowMs,
        manualRequestedAtMs: null, runningRunId: run.runId, runningSinceMs: nowMs,
      });
      return { decision, run };
    });
  }

  /** Vertex accepted the job. The full reservation stays counted for the month. */
  async submitted(runId: string, customJob: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.collection(COL.runs).doc(runId);
      const run = (await tx.get(ref)).data() as RunRecord | undefined;
      if (run) tx.set(ref, { ...run, status: 'submitted', customJob });
    });
  }

  /**
   * Vertex never accepted the job: release its reservation and give its photos back to the count, since nothing was
   * billed or learned. Leaves the newer generation in place (photos arriving meanwhile keep their markers).
   */
  async notStarted(runId: string, nowMs: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const rref = this.db.collection(COL.runs).doc(runId);
      const sref = this.stateRef();
      const [r, s] = await Promise.all([tx.get(rref), tx.get(sref)]);
      const run = r.data() as RunRecord | undefined;
      if (!run || run.status !== 'reserved') return;
      const mref = this.monthRef(run.month);
      const m = await tx.get(mref);
      const state = readState(s.data());
      tx.set(mref, { month: run.month, reservedPence: Math.max(0, Number(m.data()?.reservedPence ?? 0) - run.reservedPence) });
      tx.set(rref, { ...run, status: 'not-started', finishedAtMs: nowMs });
      tx.set(sref, { ...state, newPhotos: state.newPhotos + run.newPhotos, runningRunId: null, runningSinceMs: null });
    });
  }

  /** The CustomJob reached a final state. The reservation is kept (Google bills by the minute; we never under-count). */
  async finished(runId: string, ok: boolean, nowMs: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const rref = this.db.collection(COL.runs).doc(runId);
      const sref = this.stateRef();
      const [r, s] = await Promise.all([tx.get(rref), tx.get(sref)]);
      const run = r.data() as RunRecord | undefined;
      if (!run) return;
      tx.set(rref, { ...run, status: ok ? 'succeeded' : 'failed', finishedAtMs: nowMs });
      const state = readState(s.data());
      if (state.runningRunId === runId) tx.set(sref, { ...state, runningRunId: null, runningSinceMs: null });
    });
  }

  async run(runId: string): Promise<RunRecord | undefined> { return (await this.db.collection(COL.runs).doc(runId).get()).data() as RunRecord | undefined; }
  async recentRuns(limit = 10): Promise<RunRecord[]> {
    const snap = await this.db.collection(COL.runs).orderBy('startedAtMs', 'desc').limit(limit).get();
    return snap.docs.map((d) => d.data() as unknown as RunRecord);
  }
}

// ---- Vertex AI REST (CustomJobs only) ---------------------------------------------------------------------------------

export interface VertexClient {
  /** True when any endpoint in the region has a deployed model (an hourly bill). */
  hasDeployedEndpoint(): Promise<boolean>;
  /** Starts a batch CustomJob that stops by itself at the time limit; returns its resource name. */
  createCustomJob(run: RunRecord): Promise<string>;
  /** 'running' until the job reaches a final state. */
  jobState(name: string): Promise<'running' | 'succeeded' | 'failed'>;
}

export interface VertexRestOptions {
  project: string; config: VertexLearningConfig; trainerImage: string; serviceAccount: string;
  token: () => Promise<string>; fetcher?: typeof fetch;
}

export class VertexRest implements VertexClient {
  private readonly base: string;
  private readonly fetcher: typeof fetch;
  constructor(private readonly o: VertexRestOptions) {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(o.project)) throw new Error('KCP_VERTEX_PROJECT must be a project id');
    if (!/^[a-z0-9.-]+-docker\.pkg\.dev\/[^\s]+$/.test(o.trainerImage)) throw new Error('KCP_VERTEX_TRAINER_IMAGE must be an Artifact Registry image');
    this.base = `https://${o.config.region}-aiplatform.googleapis.com/v1/projects/${o.project}/locations/${o.config.region}`;
    this.fetcher = o.fetcher ?? fetch;
  }
  private async call(path: string, init?: RequestInit) {
    const r = await this.fetcher(`${this.base}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.o.token()}` } });
    if (!r.ok) throw new Error(`Vertex ${init?.method ?? 'GET'} ${path.split('?')[0]} ${r.status}`);
    return r.json() as Promise<Record<string, unknown>>;
  }
  async hasDeployedEndpoint() {
    const body = await this.call('/endpoints?pageSize=100');
    const endpoints = (body.endpoints ?? []) as { deployedModels?: unknown[] }[];
    return endpoints.some((e) => (e.deployedModels ?? []).length > 0) || typeof body.nextPageToken === 'string';
  }
  async createCustomJob(run: RunRecord) {
    const c = this.o.config;
    const body = {
      displayName: `kestrel-learning-${run.runId}`,
      labels: { app: 'kestrel', purpose: 'shadow-learning', trigger: run.trigger },
      jobSpec: {
        workerPoolSpecs: [{
          machineSpec: { machineType: c.machineType },
          replicaCount: '1',
          containerSpec: {
            imageUri: this.o.trainerImage,
            env: [{ name: 'KVL_RUN_ID', value: run.runId }, { name: 'KVL_GENERATION', value: String(run.generation) }],
          },
        }],
        serviceAccount: this.o.serviceAccount,
        scheduling: { timeout: `${c.maxRunHours * 3600}s`, restartJobOnWorkerRestart: false },
      },
    };
    const job = await this.call('/customJobs', { method: 'POST', body: JSON.stringify(body) });
    if (typeof job.name !== 'string') throw new Error('Vertex returned no job name');
    return job.name;
  }
  async jobState(name: string) {
    if (!name.startsWith(`projects/`) || !name.includes('/customJobs/')) throw new Error('not a CustomJob name');
    const job = await this.call(`/customJobs/${name.split('/customJobs/')[1]}`);
    const s = String(job.state ?? '');
    return s === 'JOB_STATE_SUCCEEDED' ? 'succeeded' : ['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'].includes(s) ? 'failed' : 'running';
  }
}

export interface TickDeps {
  ledger: VertexLearningLedger;
  config: VertexLearningConfig;
  /** The admin switch `vertex-learning` (settings/switch_vertex-learning === '1'). */
  switchedOn: () => Promise<boolean>;
  /** Undefined until a trainer image is configured: nothing is reserved or billed. */
  vertex?: VertexClient;
  now: () => number;
  log?: (line: string) => void;
}

export type TickResult = { started: RunRecord } | { skipped: SkipReason } | { finished: string; ok: boolean };

/** One hourly tick. Gates run cheapest first; nothing is reserved until every gate has passed. */
export async function tick(d: TickDeps): Promise<TickResult> {
  const log = d.log ?? (() => undefined);
  const c = checkConfig(d.config);
  const state = await d.ledger.state();
  // A run in progress: record its end when Vertex reports it, and start nothing else.
  if (state.runningRunId && d.vertex) {
    const run = await d.ledger.run(state.runningRunId);
    if (run?.customJob) {
      const s = await d.vertex.jobState(run.customJob);
      if (s !== 'running') { await d.ledger.finished(run.runId, s === 'succeeded', d.now()); log(`run ${run.runId} ${s}`); return { finished: run.runId, ok: s === 'succeeded' }; }
    }
  }
  if (!(await d.switchedOn())) { log('skip: switched off'); return { skipped: 'switched-off' }; }
  if (!d.vertex) { log('skip: no trainer image configured'); return { skipped: 'trainer-not-set-up' }; }
  if (await d.vertex.hasDeployedEndpoint()) { log('REFUSED: a Vertex endpoint has a deployed model (bills hourly); undeploy it first'); return { skipped: 'endpoint-deployed' }; }
  const { decision, run } = await d.ledger.claim(d.now(), c);
  if (!decision.run || !run) { const reason = decision.run ? 'nothing-due' : decision.reason; log(`skip: ${reason}`); return { skipped: reason }; }
  try {
    const name = await d.vertex.createCustomJob(run);
    await d.ledger.submitted(run.runId, name);
    log(`started ${run.trigger} run ${run.runId}: ${run.newPhotos} photos, reserved ${run.reservedPence}p`);
    return { started: { ...run, status: 'submitted', customJob: name } };
  } catch (error) {
    await d.ledger.notStarted(run.runId, d.now());
    throw error;
  }
}
