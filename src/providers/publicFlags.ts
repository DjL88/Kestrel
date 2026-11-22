/**
 * The signed public flags document for people without an account (served by the control plane at /v1/flags/public).
 *
 * - Fetched at most once a day, only when this build knows a control plane address and has a pinned key. Builds without
 *   both make no request at all.
 * - The request carries nothing about the person: no identifier, no cookies, no referrer.
 * - Every use re-checks the signature, so a changed stored copy is ignored.
 * - Any failure is silent. The app keeps the last verified copy, or its compiled defaults. Local work never waits on this.
 */
import { openEnvelope, type PinnedKeys } from '../core/signedEnvelope';
import { parseFlagSet, type FlagSet } from '../core/featureFlags';

export const PUBLIC_FLAGS_KEY = 'kestrel.public-flags.v1';
export const PUBLIC_FLAGS_REFRESH_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8_000;

interface Stored { fetchedAtMs: number; envelope: unknown }
export interface PublicFlagsOptions {
  baseUrl: string | null;
  keys: PinnedKeys;
  storage: { getItem(name: string): string | null; setItem(name: string, value: string): void };
  fetch: typeof fetch;
  now: () => number;
  online?: () => boolean;
}

export class PublicFlags {
  constructor(private readonly o: PublicFlagsOptions) {}

  get configured(): boolean { return this.o.baseUrl !== null && Object.keys(this.o.keys).length > 0; }

  private readStored(): Stored | null {
    try {
      const parsed = JSON.parse(this.o.storage.getItem(PUBLIC_FLAGS_KEY) ?? 'null') as Stored | null;
      return parsed && typeof parsed.fetchedAtMs === 'number' && 'envelope' in parsed ? parsed : null;
    } catch { return null; }
  }

  private async open(envelope: unknown): Promise<FlagSet | null> {
    const opened = await openEnvelope(envelope, this.o.keys);
    if ('failure' in opened) return null;
    const payload = opened.payload as { schema?: unknown; flags?: unknown } | null;
    if (!payload || typeof payload !== 'object' || payload.schema !== 1) return null;
    return parseFlagSet(payload.flags);
  }

  /** The last verified copy kept on this device, or null. Makes no request. */
  async stored(): Promise<FlagSet | null> {
    if (!this.configured) return null;
    const stored = this.readStored();
    return stored ? this.open(stored.envelope) : null;
  }

  /** Fetch a fresh copy when the kept one is over a day old. Returns the flags now in force, or null if there are none. */
  async refreshIfDue(): Promise<FlagSet | null> {
    if (!this.configured) return null;
    const stored = this.readStored();
    const kept = stored ? await this.open(stored.envelope) : null;
    const age = stored ? this.o.now() - stored.fetchedAtMs : Infinity;
    if (kept && age >= 0 && age < PUBLIC_FLAGS_REFRESH_MS) return kept;
    if (this.o.online && !this.o.online()) return kept;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const response = await this.o.fetch(`${this.o.baseUrl}/v1/flags/public`, {
        method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!response.ok) return kept;
      const envelope: unknown = await response.json();
      const fresh = await this.open(envelope);
      if (!fresh) return kept;
      try { this.o.storage.setItem(PUBLIC_FLAGS_KEY, JSON.stringify({ fetchedAtMs: this.o.now(), envelope } satisfies Stored)); } catch { /* storage blocked: used this session only */ }
      return fresh;
    } catch { return kept; }
  }
}
