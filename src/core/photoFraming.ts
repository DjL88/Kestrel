export interface PhotoFraming {
  ratio: number | null;
  turns: number;
  straighten: number;
  x: number;
  y: number;
  /** Crop box size as a fraction of the largest box for the ratio. Absent or 1 means the largest. */
  size?: number;
  /** The shape was not chosen from the list: dragging an edge or drawing a box may change it. */
  free?: boolean;
}

/** The named shapes in the Aspect ratio list. Choosing one fixes the shape for every drag. */
export const CROP_RATIOS: ReadonlyArray<{ label: string; ratio: number }> = [
  { label: 'Square', ratio: 1 }, { label: '4:5', ratio: 4 / 5 }, { label: '5:4', ratio: 5 / 4 },
  { label: '3:2', ratio: 3 / 2 }, { label: '9:16', ratio: 9 / 16 }, { label: '2:3', ratio: 2 / 3 },
];

/** True when a named ratio was chosen, so edges and drawing must keep it. Original and Free leave the shape open. */
export function fixedShape(framing: PhotoFraming): boolean {
  const ratio = framing.ratio;
  return ratio !== null && !framing.free && CROP_RATIOS.some((choice) => Math.abs(choice.ratio - ratio) < 1e-6);
}

export const MIN_CROP_SIZE = 0.08;

export const DEFAULT_FRAMING: PhotoFraming = { ratio: null, turns: 0, straighten: 0, x: 0.5, y: 0.5 };

export interface PixelRect { x: number; y: number; width: number; height: number }

export function cropRectangle(width: number, height: number, framing: PhotoFraming) {
  const ratio = framing.ratio ?? width / height;
  const size = Math.max(MIN_CROP_SIZE, Math.min(1, framing.size ?? 1));
  const w = Math.max(1, Math.round(Math.min(width, height * ratio) * size));
  const h = Math.max(1, Math.round(Math.min(height, width / ratio) * size));
  const clamp = (value: number, max: number) => Math.round(Math.max(0, Math.min(max, value)));
  return { width: w, height: h, x: clamp(framing.x * width - w / 2, width - w), y: clamp(framing.y * height - h / 2, height - h) };
}

export type CropCorner = 'tl' | 'tr' | 'bl' | 'br';

/**
 * Drag one corner of the crop box to a point, in pixels of the (rotated) image. The opposite corner stays put and
 * the ratio is kept. With no ratio chosen yet, the photo's own ratio is locked in, so the first drag never distorts it.
 */
export function resizeCrop(
  width: number, height: number, framing: PhotoFraming, corner: CropCorner, pointer: { x: number; y: number },
): PhotoFraming {
  const ratio = framing.ratio ?? width / height;
  const box = cropRectangle(width, height, { ...framing, ratio });
  const right = corner === 'tr' || corner === 'br';
  const bottom = corner === 'bl' || corner === 'br';
  // The corner that stays fixed is the opposite one.
  const fixed = { x: right ? box.x : box.x + box.width, y: bottom ? box.y : box.y + box.height };
  const room = { x: right ? width - fixed.x : fixed.x, y: bottom ? height - fixed.y : fixed.y };
  const wanted = Math.max(Math.abs(pointer.x - fixed.x), Math.abs(pointer.y - fixed.y) * ratio);
  const largest = Math.min(width, height * ratio);
  const w = Math.max(largest * MIN_CROP_SIZE, Math.min(wanted, room.x, room.y * ratio));
  const h = w / ratio;
  const left = right ? fixed.x : fixed.x - w;
  const top = bottom ? fixed.y : fixed.y - h;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const resized = { ...framing, ratio, size: Math.min(1, w / largest), x: clamp((left + w / 2) / width), y: clamp((top + h / 2) / height) };
  // From Original, the photo's own shape is kept for this drag but not fixed: the list then reads Free.
  return framing.ratio === null ? { ...resized, free: true } : resized;
}

export type CropEdge = 'top' | 'bottom' | 'left' | 'right';

/** The framing whose crop box is this rectangle (pixels of the rotated image). */
function framingForBox(width: number, height: number, framing: PhotoFraming, box: PixelRect, free: boolean): PhotoFraming {
  const ratio = box.width / box.height;
  const largest = Math.min(width, height * ratio);
  const next: PhotoFraming = {
    ...framing, ratio, size: Math.min(1, box.width / largest),
    x: Math.max(0, Math.min(1, (box.x + box.width / 2) / width)), y: Math.max(0, Math.min(1, (box.y + box.height / 2) / height)),
  };
  if (free) next.free = true; else delete next.free;
  return next;
}

const clampTo = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * Drag one edge of the crop box to a point. The opposite edge stays put. With an open shape (Original or Free) only
 * that edge moves; with a named ratio the box keeps it, growing or shrinking about its centre along the other side.
 */
export function resizeCropEdge(
  width: number, height: number, framing: PhotoFraming, edge: CropEdge, pointer: { x: number; y: number },
): PhotoFraming {
  const ratio = framing.ratio ?? width / height;
  const box = cropRectangle(width, height, { ...framing, ratio });
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const vertical = edge === 'top' || edge === 'bottom';
  if (!fixedShape(framing)) {
    const minW = width * MIN_CROP_SIZE;
    const minH = height * MIN_CROP_SIZE;
    const next = { ...box };
    if (edge === 'top') { next.y = clampTo(pointer.y, 0, bottom - minH); next.height = bottom - next.y; }
    if (edge === 'bottom') next.height = clampTo(pointer.y, box.y + minH, height) - box.y;
    if (edge === 'left') { next.x = clampTo(pointer.x, 0, right - minW); next.width = right - next.x; }
    if (edge === 'right') next.width = clampTo(pointer.x, box.x + minW, width) - box.x;
    return framingForBox(width, height, framing, next, true);
  }
  const smallest = Math.min(width, height * ratio) * MIN_CROP_SIZE;
  if (vertical) {
    const room = edge === 'top' ? bottom : height - box.y;
    const h = clampTo(edge === 'top' ? bottom - pointer.y : pointer.y - box.y, smallest / ratio, Math.min(room, width / ratio));
    const w = h * ratio;
    const x = clampTo(box.x + box.width / 2 - w / 2, 0, width - w);
    return framingForBox(width, height, framing, { x, y: edge === 'top' ? bottom - h : box.y, width: w, height: h }, false);
  }
  const room = edge === 'left' ? right : width - box.x;
  const w = clampTo(edge === 'left' ? right - pointer.x : pointer.x - box.x, smallest, Math.min(room, height * ratio));
  const h = w / ratio;
  const y = clampTo(box.y + box.height / 2 - h / 2, 0, height - h);
  return framingForBox(width, height, framing, { x: edge === 'left' ? right - w : box.x, y, width: w, height: h }, false);
}

/**
 * Draw a new crop box from where the drag started to where the pointer is now. A named ratio is kept, anchored at the
 * starting point; otherwise the box is exactly the dragged rectangle. Never outside the photo, never below the minimum.
 */
export function drawCrop(
  width: number, height: number, framing: PhotoFraming, start: { x: number; y: number }, end: { x: number; y: number },
): PhotoFraming {
  const from = { x: clampTo(start.x, 0, width), y: clampTo(start.y, 0, height) };
  const to = { x: clampTo(end.x, 0, width), y: clampTo(end.y, 0, height) };
  const rightward = to.x >= from.x;
  const downward = to.y >= from.y;
  let w: number;
  let h: number;
  if (fixedShape(framing)) {
    const ratio = framing.ratio!;
    const smallest = Math.min(width, height * ratio) * MIN_CROP_SIZE;
    w = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y) * ratio);
    w = Math.min(Math.max(w, smallest), width, height * ratio);
    h = w / ratio;
  } else {
    w = Math.min(Math.max(Math.abs(to.x - from.x), width * MIN_CROP_SIZE), width);
    h = Math.min(Math.max(Math.abs(to.y - from.y), height * MIN_CROP_SIZE), height);
  }
  // Near an edge the box slides inwards rather than shrinking below what was dragged.
  const x = clampTo(rightward ? from.x : from.x - w, 0, width - w);
  const y = clampTo(downward ? from.y : from.y - h, 0, height - h);
  return framingForBox(width, height, framing, { x, y, width: w, height: h }, !fixedShape(framing));
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
  // A neutral full-frame 1:1 view must never pass through a fractional
  // transform or a resampling filter. This is especially important when
  // inspecting JPEG fine detail in Original/Now comparison on mobile.
  if (framing.turns === 0 && framing.straighten === 0 &&
      crop.x === 0 && crop.y === 0 &&
      crop.width === source.naturalWidth && crop.height === source.naturalHeight &&
      region.x === 0 && region.y === 0 &&
      region.width === source.naturalWidth && region.height === source.naturalHeight &&
      outputWidth === source.naturalWidth && outputHeight === source.naturalHeight) {
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0);
    return;
  }
  context.imageSmoothingEnabled = true;
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

/**
 * The framing the preview should draw. While the crop tool is open the whole photo shows with the crop box on top,
 * so ratio, position and size are ignored. Otherwise every part of the saved framing, including the crop size, applies.
 */
export function displayFramingFor(framing: PhotoFraming, cropToolOpen: boolean): PhotoFraming {
  return cropToolOpen
    ? { ratio: null, x: 0.5, y: 0.5, turns: framing.turns, straighten: framing.straighten }
    : { ratio: framing.ratio, x: framing.x, y: framing.y, turns: framing.turns, straighten: framing.straighten, size: framing.size };
}
