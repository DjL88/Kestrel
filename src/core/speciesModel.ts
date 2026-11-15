/** Where the species model comes from and how to check it. The model is an 89 MB download the user chooses to make. */
export const SPECIES_MODEL = {
  /** Set at build time. When it is empty the feature stays out of sight, and the rest of the app is unaffected. */
  url: (import.meta.env.VITE_SPECIES_MODEL_URL as string | undefined) ?? '',
  sha256: (import.meta.env.VITE_SPECIES_MODEL_SHA256 as string | undefined) ?? 'ea4095eb31a279643dc7ea89b90b2168b4807df0fce3c40b72a43a771caee8a2',
  bytes: Number((import.meta.env.VITE_SPECIES_MODEL_BYTES as string | undefined) ?? 89041951),
  size: 224,
  mean: [0.48145466, 0.4578275, 0.40821073] as const,
  std: [0.26862954, 0.26130258, 0.27577711] as const,
  cache: 'kestrel-species-v1',
} as const;

/**
 * The model wants a 224 by 224 picture, normalised per colour. This takes RGBA pixels of that size and returns the
 * planar float numbers the model reads (all red, then all green, then all blue).
 */
export function preprocessSpecies(rgba: Uint8ClampedArray, size: number = SPECIES_MODEL.size): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      out[channel * plane + i] = (rgba[i * 4 + channel] / 255 - SPECIES_MODEL.mean[channel]) / SPECIES_MODEL.std[channel];
    }
  }
  return out;
}

/** The largest centred square of a picture: where to cut from. The model was trained on centre crops. */
export function centreSquare(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

export const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
