export interface PhotoFraming {
  ratio: number | null;
  turns: number;
  straighten: number;
  x: number;
  y: number;
}

export const DEFAULT_FRAMING: PhotoFraming = { ratio: null, turns: 0, straighten: 0, x: 0.5, y: 0.5 };

export interface PixelRect { x: number; y: number; width: number; height: number }

export function cropRectangle(width: number, height: number, framing: PhotoFraming) {
  const ratio = framing.ratio ?? width / height;
  const w = Math.max(1, Math.round(Math.min(width, height * ratio)));
  const h = Math.max(1, Math.round(Math.min(height, width / ratio)));
  const clamp = (value: number, max: number) => Math.round(Math.max(0, Math.min(max, value)));
  return { width: w, height: h, x: clamp(framing.x * width - w / 2, width - w), y: clamp(framing.y * height - h / 2, height - h) };
}

/** Estimate a crop anchor from local detail in a small preview. */
export function detailAnchor(pixels: Uint8ClampedArray, width: number, height: number) {
  let total = 0;
  let xSum = 0;
  let ySum = 0;
  const luma = (i: number) => 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const i = (y * width + x) * 4;
      const nx = x / (width - 1);
      const ny = y / (height - 1);
      const detail = Math.abs(luma(i + 4) - luma(i - 4)) + Math.abs(luma(i + 4 * width) - luma(i - 4 * width));
      const weight = Math.min(detail, 100) * Math.max(0.1, 1 - Math.hypot(nx - 0.5, ny - 0.5));
      total += weight;
      xSum += nx * weight;
      ySum += ny * weight;
    }
  }
  return total ? { x: xSum / total, y: ySum / total } : { x: 0.5, y: 0.5 };
}

export function framedSize(width: number, height: number, framing: PhotoFraming): PixelRect {
  return framing.turns % 2 ? cropRectangle(height, width, framing) : cropRectangle(width, height, framing);
}

export function thirdsCropAnchor(width: number, height: number, ratio: number, detail: { x: number; y: number }) {
  const crop = cropRectangle(width, height, { ...DEFAULT_FRAMING, ratio });
  function centre(point: number, span: number) {
    const third = Math.abs(point - 0.5) < 0.04 ? 0.5 : point < 0.5 ? 1 / 3 : 2 / 3;
    return Math.max(0, Math.min(1, point + (0.5 - third) * span));
  }
  return { x: centre(detail.x, crop.width / width), y: centre(detail.y, crop.height / height) };
}

export function rotationCoverage(width: number, height: number, radians: number) {
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return Math.max(cos + height / width * sin, cos + width / height * sin);
}

/** Measure continuous near-horizontal contrast. Return no correction for ambiguous detail. */
export function estimateLevel(pixels: Uint8ClampedArray, width: number, height: number): number | null {
  if (width < 24 || height < 16) return null;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) luma[i] = 0.213 * pixels[i * 4] + 0.715 * pixels[i * 4 + 1] + 0.072 * pixels[i * 4 + 2];
  const results: { angle: number; score: number }[] = [];
  const xMin = Math.ceil(width / 10);
  const xMax = Math.floor(width * 0.9);
  const samples = xMax - xMin;
  for (let angle = -12; angle <= 12; angle += 0.5) {
    const slope = Math.tan(angle * Math.PI / 180);
    let strongest = 0;
    for (let row = Math.ceil(height * 0.2); row < height * 0.8; row += 1) {
      let score = 0;
      let count = 0;
      for (let x = xMin; x < xMax; x += 1) {
        const y = Math.round(row + slope * (x - width / 2));
        if (y < 2 || y >= height - 2) continue;
        const edge = Math.abs(luma[(y + 1) * width + x] - luma[(y - 1) * width + x]);
        if (edge >= 24) {
          count += 1;
          score += Math.min(edge, 64);
        }
      }
      if (count >= samples * 0.55) strongest = Math.max(strongest, score / samples);
    }
    results.push({ angle, score: strongest });
  }
  results.sort((a, b) => b.score - a.score || Math.abs(a.angle) - Math.abs(b.angle));
  const [best] = results;
  const competing = results.find(({ angle }) => Math.abs(angle - best.angle) >= 3);
  if (best.score < 18 || (competing && competing.score > best.score * 0.92)) return null;
  return -best.angle || 0;
}

export function drawFramedPhoto(
  source: HTMLImageElement, output: HTMLCanvasElement, framing: PhotoFraming,
  options?: { region?: PixelRect; scale?: number },
) {
  const rotated = framing.turns % 2 !== 0;
  const width = rotated ? source.naturalHeight : source.naturalWidth;
  const height = rotated ? source.naturalWidth : source.naturalHeight;
  const crop = cropRectangle(width, height, framing);
  const region = options?.region ?? { x: 0, y: 0, width: crop.width, height: crop.height };
  const scale = options?.scale ?? 1;
  const outputWidth = Math.max(1, Math.round(region.width * scale));
  const outputHeight = Math.max(1, Math.round(region.height * scale));
  if (output.width !== outputWidth) output.width = outputWidth;
  if (output.height !== outputHeight) output.height = outputHeight;
  const context = output.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.resetTransform();
  context.clearRect(0, 0, outputWidth, outputHeight);
  context.imageSmoothingQuality = 'high';
  const angle = framing.straighten * Math.PI / 180;
  const coverage = rotationCoverage(width, height, angle);
  context.scale(outputWidth / region.width, outputHeight / region.height);
  context.translate(width / 2 - crop.x - region.x, height / 2 - crop.y - region.y);
  context.rotate(angle + framing.turns * Math.PI / 2);
  context.scale(coverage, coverage);
  context.drawImage(source, -source.naturalWidth / 2, -source.naturalHeight / 2);
  context.resetTransform();
}
