import { CLOUD_RECIPE_MAX_BYTES, FULL_FILE_CONSENT_OFF, grantFullFileConsent, parseFullFileConsent, withdrawFullFileConsent,
  type CloudRecipeInputKind, type CloudRecipeSettings, type FullFileConsent } from '../core/cloudRecipe';
import { CLOUD_RECIPE_PROTOCOL } from '../core/cloudRecipe';
import { runCloudJob } from './cloudJobTransport';

/**
 * Where a cloud recipe job runs (x-std-cloud-recipe). The service gets one picture and answers with edit settings as a
 * few KB of JSON. Every implementation deletes its copy of the picture when the job ends, whether it worked or not.
 *
 * Two implementations: the HTTP one goes through the control plane's job routes (`cloudJobTransport.ts`), which have
 * no `recipe` runner yet, so it fails plainly until the backend adds one; the in-memory one stands in for the service
 * in tests and in development. Nothing here is deployed or paid for.
 */
export interface CloudRecipeJob {
  input: Blob;
  inputKind: CloudRecipeInputKind;
  /** The person's press of Send for this one job. Nothing is uploaded without it. */
  userConsent: boolean;
  signal?: AbortSignal;
}

export interface CloudRecipeAnswer { jobId: string; bytes: Uint8Array }

export interface CloudRecipeService {
  run(job: CloudRecipeJob): Promise<CloudRecipeAnswer>;
}

export interface CloudRecipeConnection {
  baseUrl: string;
  session: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/** The control-plane service. Its `finish` call, made even when the job fails or is cancelled, deletes the upload. */
export function httpCloudRecipeService(connection: CloudRecipeConnection): CloudRecipeService {
  return {
    async run(job) {
      if (job.userConsent !== true) throw new Error('Cloud edit settings need your approval for this photo.');
      let jobId = '';
      const blob = await runCloudJob(connection, {
        kind: 'recipe', inputKind: job.inputKind, input: job.input, userConsent: true, signal: job.signal,
        maxResultBytes: CLOUD_RECIPE_MAX_BYTES, onJobId: (id) => { jobId = id; },
      });
      return { jobId, bytes: new Uint8Array(await blob.arrayBuffer()) };
    },
  };
}

export interface InMemoryRecipeService extends CloudRecipeService {
  /** Uploads still held by the fake service. Empty after every job: the copy is deleted when the job ends. */
  readonly held: ReadonlyMap<string, { kind: CloudRecipeInputKind; bytes: number }>;
  /** Every upload the fake ever received, for tests to check what left the device. */
  readonly received: readonly { jobId: string; kind: CloudRecipeInputKind; bytes: number; deleted: boolean }[];
}

/**
 * A stand-in service that works without a network. `decide` plays the cloud's part and returns the settings; when it
 * throws, the job fails, and the upload is still deleted.
 */
export function inMemoryCloudRecipeService(
  decide: (input: { kind: CloudRecipeInputKind; bytes: Uint8Array }) => CloudRecipeSettings | Promise<CloudRecipeSettings>,
  options: { producer?: { name: string; version: string }; notes?: string[] } = {},
): InMemoryRecipeService {
  const held = new Map<string, { kind: CloudRecipeInputKind; bytes: number }>();
  const received: { jobId: string; kind: CloudRecipeInputKind; bytes: number; deleted: boolean }[] = [];
  let next = 0;
  return {
    held,
    received,
    async run(job) {
      if (job.userConsent !== true) throw new Error('Cloud edit settings need your approval for this photo.');
      job.signal?.throwIfAborted();
      const jobId = `fake-recipe-${++next}`;
      const bytes = new Uint8Array(await job.input.arrayBuffer());
      const entry = { jobId, kind: job.inputKind, bytes: bytes.byteLength, deleted: false };
      received.push(entry);
      held.set(jobId, { kind: job.inputKind, bytes: bytes.byteLength });
      try {
        const settings = await decide({ kind: job.inputKind, bytes });
        job.signal?.throwIfAborted();
        const answer = { protocol: CLOUD_RECIPE_PROTOCOL, jobId, input: job.inputKind, settings,
          ...(options.producer ? { producer: options.producer } : {}), ...(options.notes ? { notes: options.notes } : {}) };
        return { jobId, bytes: new TextEncoder().encode(JSON.stringify(answer)) };
      } finally {
        held.delete(jobId);
        entry.deleted = true;
      }
    },
  };
}

const FULL_FILE_KEY = 'kestrel.cloudRecipe.fullFile.v1';
/** This device's own switch for the preview, like the other flagged previews: `localStorage[key] = '1'`. */
export const CLOUD_RECIPE_PREVIEW_KEY = 'kestrel.preview.cloudRecipe.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;
const defaultStore = (): Store => (typeof localStorage === 'undefined' ? null : localStorage);

export function cloudRecipePreviewOn(storage: Store = defaultStore()): boolean {
  try { return storage?.getItem(CLOUD_RECIPE_PREVIEW_KEY) === '1'; } catch { return false; }
}

/** The person's full-file opt-in on this device. Unreadable storage counts as off. */
export function readFullFileConsent(storage: Store = defaultStore()): FullFileConsent {
  try {
    const text = storage?.getItem(FULL_FILE_KEY);
    return text ? parseFullFileConsent(JSON.parse(text)) : FULL_FILE_CONSENT_OFF;
  } catch { return FULL_FILE_CONSENT_OFF; }
}

/** Turn the opt-in on or off. Returns what is in force afterwards, which is off if it could not be saved. */
export function saveFullFileConsent(on: boolean, nowMs = Date.now(), storage: Store = defaultStore()): FullFileConsent {
  const next = on ? grantFullFileConsent(nowMs) : withdrawFullFileConsent(nowMs);
  try { storage?.setItem(FULL_FILE_KEY, JSON.stringify(next)); } catch { return FULL_FILE_CONSENT_OFF; }
  return readFullFileConsent(storage);
}
