/**
 * The desktop vision model's own measurements (P0 #703), as the Rust runtime (crates/kestrel-vision) reports them:
 * load time, memory gained while loading (from the operating system) and the last inference split into looking and
 * writing. Only the exact shape is accepted; anything missing, negative or malformed becomes null ("not measured"),
 * never a number.
 */
export const LOCAL_VISION_ID = 'smolvlm2-500m-desktop';

export interface LocalVisionMetrics {
  installed: boolean;
  digestsVerified: boolean;
  loadMs: number | null;
  loadRamBytes: number | null;
  processRamBytes: number | null;
  visionMs: number | null;
  generateMs: number | null;
  runs: number;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

export function parseLocalVisionMetrics(raw: unknown): LocalVisionMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.revision !== 'string') return null;
  return {
    installed: r.installed === true,
    digestsVerified: r.digestsVerified === true,
    loadMs: num(r.loadMs),
    loadRamBytes: num(r.loadRamBytes),
    processRamBytes: num(r.processRamBytes),
    visionMs: num(r.visionMs),
    generateMs: num(r.generateMs),
    runs: num(r.runs) ?? 0,
  };
}

/** One inference is looking at the photo plus writing the answer; null unless both were measured. */
export function inferenceMs(metrics: Pick<LocalVisionMetrics, 'visionMs' | 'generateMs'>): number | null {
  return metrics.visionMs !== null && metrics.generateMs !== null ? metrics.visionMs + metrics.generateMs : null;
}
