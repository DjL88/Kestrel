/**
 * Controls how Kestrel executes computer-vision and RAW/TIFF analysis.
 * - 'auto': uses optional bundled ONNX / native decoders if installed, automatically falling back to Kestrel's own zero-dependency experimental engines when absent.
 * - 'kestrel-only': strictly runs Kestrel's own built-in experimental algorithms without external model weights or third-party AI runtime dependencies.
 */
export type VisionEngineMode = 'auto' | 'kestrel-only';

const ENGINE_KEY = 'kestrel-vision-engine-v1';

export function readVisionEngineMode(): VisionEngineMode {
  try {
    return localStorage.getItem(ENGINE_KEY) === 'kestrel-only' ? 'kestrel-only' : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeVisionEngineMode(mode: VisionEngineMode): void {
  try {
    localStorage.setItem(ENGINE_KEY, mode);
  } catch {
    /* ignore storage limits in private browsing */
  }
}

export function prefersExperimentalOnly(): boolean {
  return readVisionEngineMode() === 'kestrel-only';
}
