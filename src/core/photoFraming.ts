export interface PhotoFraming {
  ratio: number | null;
  turns: number;
  straighten: number;
  x: number;
  y: number;
}

export const DEFAULT_FRAMING: PhotoFraming = { ratio: null, turns: 0, straighten: 0, x: 0.5, y: 0.5 };

export function cropRectangle(width: number, height: number, framing: PhotoFraming) {
  const ratio = framing.ratio ?? width / height;
  const w = Math.max(1, Math.round(Math.min(width, height * ratio)));
  const h = Math.max(1, Math.round(Math.min(height, width / ratio)));
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
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

export function drawFramedPhoto(source: HTMLCanvasElement, output: HTMLCanvasElement, framing: PhotoFraming) {
  const rotated = framing.turns % 2 !== 0;
  const width = rotated ? source.height : source.width;
  const height = rotated ? source.width : source.height;
  const crop = cropRectangle(width, height, framing);
  output.width = crop.width;
  output.height = crop.height;
  const context = output.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const angle = framing.straighten * Math.PI / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const coverage = Math.max(cos + height / width * sin, cos + width / height * sin);
  context.translate(width / 2 - crop.x, height / 2 - crop.y);
  context.rotate(angle + framing.turns * Math.PI / 2);
  context.scale(coverage, coverage);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  context.resetTransform();
}
