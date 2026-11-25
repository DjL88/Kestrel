/**
 * Settings > AI > Models on this device (#703). Turns what the desktop runtime reports into rows to show. Pure and
 * unit-tested. Every number comes from the runtime's own clocks and the operating system; a value the runtime has not
 * measured stays `null` here and is shown as "Not measured", never as zero or a typed-in estimate.
 */

export interface ModelFileDigest { name: string; bytes: number; sha256: string }

export interface LocalModelMetrics {
  installed: boolean;
  revision: string;
  files: ModelFileDigest[];
  loaded: boolean;
  digestsVerified: boolean;
  loadMs: number | null;
  loadRamBytes: number | null;
  processRamBytes: number | null;
  visionMs: number | null;
  generateMs: number | null;
  newTokens: number | null;
  runs: number;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** Accept only the shape the runtime sends; anything else becomes "not measured" rather than a made-up value. */
export function parseModelMetrics(raw: unknown): LocalModelMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.revision !== 'string' || !Array.isArray(r.files)) return null;
  const files = r.files.flatMap((file): ModelFileDigest[] => {
    const f = file as Record<string, unknown> | null;
    return f && typeof f.name === 'string' && typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256) && num(f.bytes) !== null
      ? [{ name: f.name, bytes: f.bytes as number, sha256: f.sha256 }] : [];
  });
  return {
    installed: r.installed === true,
    revision: r.revision,
    files,
    loaded: r.loaded === true,
    digestsVerified: r.digestsVerified === true,
    loadMs: num(r.loadMs),
    loadRamBytes: num(r.loadRamBytes),
    processRamBytes: num(r.processRamBytes),
    visionMs: num(r.visionMs),
    generateMs: num(r.generateMs),
    newTokens: num(r.newTokens),
    runs: num(r.runs) ?? 0,
  };
}

/** "850 ms", "12.4 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Binary units, as operating systems show memory: "512 MB", "1.4 GB". */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** Long digests are shown in full on hover/copy; on screen the first and last 8 characters are enough to compare. */
export function shortDigest(sha256: string): string {
  return sha256.length > 20 ? `${sha256.slice(0, 8)}…${sha256.slice(-8)}` : sha256;
}

/** Last inference in total: looking at the photo plus writing the answer. Null unless both were measured. */
export function inferenceMs(metrics: LocalModelMetrics): number | null {
  return metrics.visionMs !== null && metrics.generateMs !== null ? metrics.visionMs + metrics.generateMs : null;
}
