import type { MaskContext } from './masks';

/**
 * Spot healing: remove sensor dust, a stray twig or perch clutter by copying pixels from a nearby part of the same photo.
 * Nothing is generated: every pixel placed comes from the photo itself, at a whole-pixel offset. In 'heal' mode the copied
 * patch is also shifted, smoothly, by the difference in tone and colour between the two patches' edges, so it blends with
 * its new surroundings; 'clone' copies exactly. The spots live in the recipe, so they are reversible and never touch the original.
 *
 * Coordinates are in the framed photograph (0 to 1 across its width and height), like masks. The radius is a share of the
 * framed photograph's long edge, so a spot covers the same part of the picture at every size.
 */
export interface HealSpot {
  id: string;
  /** Centre of the area being covered. */
  x: number;
  y: number;
  /** Centre of the area the pixels are copied from. */
  sx: number;
  sy: number;
  /** Radius as a share of the framed photograph's long edge. */
  r: number;
  mode: 'heal' | 'clone';
  /** Edge softness, 0 (hard) to 1 (soft). Absent means DEFAULT_HEAL_FEATHER. */
  feather?: number;
  hidden?: boolean;
}

export const MAX_HEAL_SPOTS = 200;
export const MIN_HEAL_RADIUS = 0.002;
export const MAX_HEAL_RADIUS = 0.15;
export const DEFAULT_HEAL_RADIUS = 0.015;
export const DEFAULT_HEAL_FEATHER = 0.5;

const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function validHealSpot(value: unknown): value is HealSpot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const spot = value as Record<string, unknown>;
  return typeof spot.id === 'string' && spot.id.length > 0 && spot.id.length <= 80
    && finite(spot.x, 0, 1) && finite(spot.y, 0, 1) && finite(spot.sx, 0, 1) && finite(spot.sy, 0, 1)
    && finite(spot.r, MIN_HEAL_RADIUS, MAX_HEAL_RADIUS) && (spot.mode === 'heal' || spot.mode === 'clone')
    && (spot.feather === undefined || finite(spot.feather, 0, 1)) && (spot.hidden === undefined || typeof spot.hidden === 'boolean');
}

export function validHeal(value: unknown): value is HealSpot[] {
  if (!Array.isArray(value) || value.length > MAX_HEAL_SPOTS) return false;
  const ids = new Set<string>();
  return value.every((spot) => {
    if (!validHealSpot(spot) || ids.has(spot.id)) return false;
    ids.add(spot.id);
    return true;
  });
}

/** True when at least one spot changes pixels. */
export const hasHeal = (spots: readonly HealSpot[] | undefined): boolean => Boolean(spots?.some((spot) => !spot.hidden));

const ANGLES = 32;

interface Placement { cx: number; cy: number; dx: number; dy: number; radius: number }

/** Where a spot lands on this canvas, in its pixels. The source offset is whole pixels so copies are never resampled. */
function place(spot: HealSpot, width: number, height: number, context: MaskContext, imageEdge: number): Placement {
  const { view } = context;
  const fullWidth = width / view.w, fullHeight = height / view.h;
  const cx = (spot.x - view.x) * fullWidth, cy = (spot.y - view.y) * fullHeight;
  const dx = Math.round((spot.sx - spot.x) * fullWidth), dy = Math.round((spot.sy - spot.y) * fullHeight);
  return { cx, cy, dx, dy, radius: Math.max(0.75, spot.r * imageEdge) };
}

/** Average of a small box around a pixel, per channel, or null when it falls off the canvas. */
function sampleBox(
  pixels: ArrayLike<number>, width: number, height: number, channels: number, x: number, y: number, half: number, out: Float64Array,
): boolean {
  const x0 = Math.max(0, Math.round(x) - half), x1 = Math.min(width - 1, Math.round(x) + half);
  const y0 = Math.max(0, Math.round(y) - half), y1 = Math.min(height - 1, Math.round(y) + half);
  if (x0 > x1 || y0 > y1) return false;
  out.fill(0);
  let count = 0;
  for (let row = y0; row <= y1; row += 1) {
    for (let col = x0; col <= x1; col += 1) {
      const index = (row * width + col) * channels;
      for (let c = 0; c < 3; c += 1) out[c] += pixels[index + c];
      count += 1;
    }
  }
  for (let c = 0; c < 3; c += 1) out[c] /= count;
  return true;
}

/**
 * The tone and colour shift that makes the copied patch meet the area round the spot: measured just outside the spot's
 * edge at ANGLES points, target minus source, smoothed round the ring. Missing samples (off the canvas) take the mean.
 */
function edgeShift(
  pixels: ArrayLike<number>, width: number, height: number, channels: number, at: Placement,
): { ring: Float64Array; mean: Float64Array } {
  const ring = new Float64Array(ANGLES * 3);
  const known = new Uint8Array(ANGLES);
  const mean = new Float64Array(3);
  const target = new Float64Array(3), source = new Float64Array(3);
  const reach = at.radius + Math.max(1, at.radius * 0.12);
  const half = Math.max(1, Math.round(at.radius * 0.1));
  let count = 0;
  for (let a = 0; a < ANGLES; a += 1) {
    const angle = (a / ANGLES) * Math.PI * 2;
    const x = at.cx + Math.cos(angle) * reach, y = at.cy + Math.sin(angle) * reach;
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1 || x + at.dx < 0 || y + at.dy < 0 || x + at.dx > width - 1 || y + at.dy > height - 1) continue;
    if (!sampleBox(pixels, width, height, channels, x, y, half, target) || !sampleBox(pixels, width, height, channels, x + at.dx, y + at.dy, half, source)) continue;
    for (let c = 0; c < 3; c += 1) {
      ring[a * 3 + c] = target[c] - source[c];
      mean[c] += ring[a * 3 + c];
    }
    known[a] = 1;
    count += 1;
  }
  if (count) for (let c = 0; c < 3; c += 1) mean[c] /= count;
  for (let a = 0; a < ANGLES; a += 1) if (!known[a]) for (let c = 0; c < 3; c += 1) ring[a * 3 + c] = mean[c];
  // One pass of smoothing round the ring, so a single busy sample cannot streak the patch.
  const smooth = new Float64Array(ring.length);
  for (let a = 0; a < ANGLES; a += 1) {
    const before = (a + ANGLES - 1) % ANGLES, after = (a + 1) % ANGLES;
    for (let c = 0; c < 3; c += 1) smooth[a * 3 + c] = (ring[before * 3 + c] + 2 * ring[a * 3 + c] + ring[after * 3 + c]) / 4;
  }
  return { ring: smooth, mean };
}

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Heal or clone one spot in place. */
function healOne(
  pixels: Uint8ClampedArray | Uint16Array | Float32Array | number[], width: number, height: number, channels: number, max: number,
  spot: HealSpot, at: Placement,
): void {
  const { cx, cy, dx, dy, radius } = at;
  if (dx === 0 && dy === 0) return;
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(height - 1, Math.ceil(cy + radius));
  if (x0 > x1 || y0 > y1) return;
  const feather = spot.feather ?? DEFAULT_HEAL_FEATHER;
  // The soft edge takes up to 60% of the radius; even a hard spot keeps one pixel of softening.
  const inner = Math.max(0, radius * (1 - 0.6 * feather) - (feather === 0 ? 1 : 0));
  const shift = spot.mode === 'heal' ? edgeShift(pixels, width, height, channels, at) : null;
  // Read the whole source patch before writing, so a source that overlaps the spot copies the photo as it was.
  const boxWidth = x1 - x0 + 1, boxHeight = y1 - y0 + 1;
  const patch = new Float64Array(boxWidth * boxHeight * 3);
  const inside = new Uint8Array(boxWidth * boxHeight);
  for (let row = y0; row <= y1; row += 1) {
    const sy = row + dy;
    if (sy < 0 || sy >= height) continue;
    for (let col = x0; col <= x1; col += 1) {
      const sx = col + dx;
      if (sx < 0 || sx >= width) continue;
      const cell = (row - y0) * boxWidth + (col - x0), from = (sy * width + sx) * channels;
      for (let c = 0; c < 3; c += 1) patch[cell * 3 + c] = pixels[from + c];
      inside[cell] = 1;
    }
  }
  for (let row = y0; row <= y1; row += 1) {
    for (let col = x0; col <= x1; col += 1) {
      const cell = (row - y0) * boxWidth + (col - x0);
      if (!inside[cell]) continue;
      const ox = col + 0.5 - cx, oy = row + 0.5 - cy;
      const distance = Math.hypot(ox, oy);
      if (distance >= radius) continue;
      const alpha = distance <= inner ? 1 : 1 - smoothstep((distance - inner) / Math.max(1e-6, radius - inner));
      if (alpha <= 0) continue;
      const to = (row * width + col) * channels;
      let offsetAt = 0, offsetNext = 0, weight = 0, blend = 0;
      if (shift) {
        // The membrane: the mean shift at the centre, the measured edge shift at the rim, interpolated round the ring.
        const position = ((Math.atan2(oy, ox) / (Math.PI * 2) + 1) % 1) * ANGLES;
        offsetAt = Math.floor(position) % ANGLES;
        offsetNext = (offsetAt + 1) % ANGLES;
        weight = position - Math.floor(position);
        blend = Math.min(1, distance / radius);
      }
      for (let c = 0; c < 3; c += 1) {
        let value = patch[cell * 3 + c];
        if (shift) {
          const rim = shift.ring[offsetAt * 3 + c] * (1 - weight) + shift.ring[offsetNext * 3 + c] * weight;
          value += shift.mean[c] + (rim - shift.mean[c]) * blend;
        }
        const mixed = pixels[to + c] + (value - pixels[to + c]) * alpha;
        const clamped = Math.min(max, Math.max(0, mixed));
        pixels[to + c] = max === 1 ? clamped : Math.round(clamped);
      }
    }
  }
}

/**
 * Apply every visible spot, in order, in place. `channels` is 3 or 4 (alpha is left alone), `max` the white value (255,
 * 65535 or 1). `context` says which part of the framed photo the pixels show; `imageEdge` is the whole framed photo's long
 * edge in these pixels. A later spot may copy from an earlier healed one, as the person saw it when they placed it.
 */
export function applyHeal(
  pixels: Uint8ClampedArray | Uint16Array | Float32Array | number[], width: number, height: number, channels: number, max: number,
  spots: readonly HealSpot[] | undefined, context: MaskContext, imageEdge = context.imageEdge ?? Math.max(width / context.view.w, height / context.view.h),
): void {
  if (!spots?.length) return;
  for (const spot of spots) {
    if (spot.hidden || !validHealSpot(spot)) continue;
    healOne(pixels, width, height, channels, max, spot, place(spot, width, height, context, imageEdge));
  }
}

export interface HealSource { sx: number; sy: number; score: number }

/**
 * Nearby places to copy from for a spot at (x, y) with radius r (framed-photo units, as stored), best first. Each is scored
 * by how well the ring round it matches the ring round the spot (texture and tone), how even its middle is (so dust is not
 * copied onto dust), and a little by distance. Measured on the picture as given; at most `limit` well-separated results.
 */
export function findHealSources(
  pixels: ArrayLike<number>, width: number, height: number, channels: number,
  x: number, y: number, r: number, limit = 6,
): HealSource[] {
  const edge = Math.max(width, height);
  const radius = Math.max(1, r * edge);
  const cx = x * width, cy = y * height;
  // Up to 48 ring samples and 48 interior samples, so the search stays quick at any spot size.
  const ringPoints: Array<[number, number]> = [];
  for (let a = 0; a < 24; a += 1) {
    const angle = (a / 24) * Math.PI * 2;
    for (const reach of [1.15, 1.45]) ringPoints.push([Math.cos(angle) * radius * reach, Math.sin(angle) * radius * reach]);
  }
  const corePoints: Array<[number, number]> = [];
  for (let a = 0; a < 16; a += 1) {
    const angle = (a / 16) * Math.PI * 2;
    for (const reach of [0, 0.4, 0.8]) corePoints.push([Math.cos(angle) * radius * reach, Math.sin(angle) * radius * reach]);
  }
  const lumaAt = (px: number, py: number): number | null => {
    const col = Math.round(px), row = Math.round(py);
    if (col < 0 || row < 0 || col >= width || row >= height) return null;
    const index = (row * width + col) * channels;
    return 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
  };
  const colourAt = (px: number, py: number): [number, number, number] | null => {
    const col = Math.round(px), row = Math.round(py);
    if (col < 0 || row < 0 || col >= width || row >= height) return null;
    const index = (row * width + col) * channels;
    return [pixels[index], pixels[index + 1], pixels[index + 2]];
  };
  const targetRing = ringPoints.map(([ox, oy]) => colourAt(cx + ox, cy + oy));
  const known = targetRing.filter(Boolean) as Array<[number, number, number]>;
  if (!known.length) return [];
  const targetMean = [0, 1, 2].map((c) => known.reduce((sum, colour) => sum + colour[c], 0) / known.length);
  const ringSpread = Math.sqrt(known.reduce((sum, colour) => sum + (colour[0] - targetMean[0]) ** 2 + (colour[1] - targetMean[1]) ** 2 + (colour[2] - targetMean[2]) ** 2, 0) / known.length / 3);
  const found: HealSource[] = [];
  for (const distance of [2.2, 2.8, 3.6, 4.6]) {
    for (let a = 0; a < 16; a += 1) {
      const angle = (a / 16) * Math.PI * 2 + (distance === 2.8 || distance === 4.6 ? Math.PI / 16 : 0);
      const px = cx + Math.cos(angle) * radius * distance, py = cy + Math.sin(angle) * radius * distance;
      // The whole copied patch and its ring must be on the picture.
      if (px - radius * 1.5 < 0 || py - radius * 1.5 < 0 || px + radius * 1.5 > width - 1 || py + radius * 1.5 > height - 1) continue;
      let ringError = 0, ringCount = 0;
      ringPoints.forEach(([ox, oy], index) => {
        const target = targetRing[index], candidate = colourAt(px + ox, py + oy);
        if (!target || !candidate) return;
        ringError += (target[0] - candidate[0]) ** 2 + (target[1] - candidate[1]) ** 2 + (target[2] - candidate[2]) ** 2;
        ringCount += 3;
      });
      if (!ringCount) continue;
      const core = corePoints.map(([ox, oy]) => lumaAt(px + ox, py + oy)).filter((value): value is number => value !== null);
      const coreMean = core.reduce((sum, value) => sum + value, 0) / core.length;
      const coreSpread = Math.sqrt(core.reduce((sum, value) => sum + (value - coreMean) ** 2, 0) / core.length);
      const targetLuma = 0.2126 * targetMean[0] + 0.7152 * targetMean[1] + 0.0722 * targetMean[2];
      // A middle much busier than the spot's surroundings probably holds something that should not be copied.
      const busy = Math.max(0, coreSpread - ringSpread * 1.2);
      const score = Math.sqrt(ringError / ringCount) + busy * 1.5 + Math.abs(coreMean - targetLuma) * 0.5 + distance * 0.5;
      found.push({ sx: px / width, sy: py / height, score });
    }
  }
  found.sort((a, b) => a.score - b.score);
  const kept: HealSource[] = [];
  for (const candidate of found) {
    if (kept.some((other) => Math.hypot((other.sx - candidate.sx) * width, (other.sy - candidate.sy) * height) < radius * 1.2)) continue;
    kept.push({ sx: Number(candidate.sx.toFixed(5)), sy: Number(candidate.sy.toFixed(5)), score: candidate.score });
    if (kept.length >= limit) break;
  }
  return kept;
}

/** Keep a spot's numbers inside their valid ranges. */
export function clampHealSpot(spot: HealSpot): HealSpot {
  const unit = (value: number) => Math.min(1, Math.max(0, Number(value.toFixed(5))));
  return {
    ...spot, x: unit(spot.x), y: unit(spot.y), sx: unit(spot.sx), sy: unit(spot.sy),
    r: Math.min(MAX_HEAL_RADIUS, Math.max(MIN_HEAL_RADIUS, Number(spot.r.toFixed(5)))),
    ...(spot.feather !== undefined ? { feather: Math.min(1, Math.max(0, spot.feather)) } : {}),
  };
}
