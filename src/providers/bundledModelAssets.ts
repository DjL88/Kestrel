/**
 * Optional on-device inference assets.
 *
 * AI Studio's GitHub import may omit large binary ONNX files even when they
 * are committed in the source repository. A static `import ...onnx?url`
 * makes Vite fail to start before the app can render. A glob compiles to an
 * empty map when no models are present, while continuing to bundle and hash
 * the actual binary files in full desktop/CI checkouts.
 *
 * Never fetch arbitrary remote weights or substitute an unverified model.
 * Detection functions will simply be unavailable until the licensed,
 * checksum-verified original model is present.
 */
// Vite replaces the static glob in desktop/web builds. The plain Node unit
// runner has no import.meta.glob, so model import must safely fall back to an
// empty registry there. Never substitute a preview or fetch unverified weights.
const availableModels: Record<string, string> = (() => {
  try {
    return import.meta.glob('../assets/models/*.onnx', {
      eager: true,
      query: '?url',
      import: 'default',
    }) as Record<string, string>;
  } catch {
    return {};
  }
})();

type ModelFilename = 'yolox_tiny.onnx' | 'u2netp.onnx';

export function bundledModelUrl(filename: ModelFilename): string | null {
  return availableModels[`../assets/models/${filename}`] ?? null;
}
