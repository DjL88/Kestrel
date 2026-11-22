/** Pixel tools for watermark artwork. Pure and local: they take RGBA pixels and return new RGBA pixels. */
export interface Rgba { data: Uint8ClampedArray; width: number; height: number }

export interface CutOutResult {
  image: Rgba;
  /** Share of the picture that became transparent, 0 to 1. */
  removed: number;
  /** True when so much went that the background was probably not a flat colour. The original is returned unchanged. */
  tooMuch: boolean;
}

const MAX_REMOVED = 0.97;
const MAX_DISTANCE = 255 * Math.sqrt(3);

const distance = (data: Uint8ClampedArray, index: number, r: number, g: number, b: number) =>
  Math.hypot(data[index] - r, data[index + 1] - g, data[index + 2] - b);

/** The background colour: the most common colour round the border (a flat background dominates it). The exact colour is
 * the most frequent one inside the winning group of similar colours, so a pure flat background is matched exactly. */
export function borderColour(img: Rgba): [number, number, number] {
  const groups = new Map<number, { n: number; exact: Map<number, number> }>();
  const add = (x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    if (img.data[i + 3] < 128) return; // already transparent: not a colour to remove
    const group = ((img.data[i] >> 4) << 8) | ((img.data[i + 1] >> 4) << 4) | (img.data[i + 2] >> 4);
    const exact = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    const entry = groups.get(group) ?? { n: 0, exact: new Map<number, number>() };
    entry.n += 1;
    entry.exact.set(exact, (entry.exact.get(exact) ?? 0) + 1);
    groups.set(group, entry);
  };
  for (let x = 0; x < img.width; x += 1) { add(x, 0); add(x, img.height - 1); }
  for (let y = 1; y < img.height - 1; y += 1) { add(0, y); add(img.width - 1, y); }
  let best: { n: number; exact: Map<number, number> } | undefined;
  for (const entry of groups.values()) if (!best || entry.n > best.n) best = entry;
  if (!best) return [255, 255, 255];
  let colour = 0, top = -1;
  for (const [value, count] of best.exact) if (count > top) { top = count; colour = value; }
  return [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255];
}

/**
 * Remove a flat background, such as the white round a logo saved as a JPEG. Only the part of the background that
 * connects to the picture's edge is removed, so white INSIDE the logo (a hole in a letter, a white highlight) stays.
 * `tolerance` is 0 to 100: how far from the background colour a pixel may be and still count as background.
 * `soften` fades a thin band along the new edge so it is not jagged. A busy background is not a flat colour: if more
 * than 97% would go, nothing is changed and `tooMuch` says so.
 */
export function cutOutBackground(img: Rgba, tolerance: number, soften = 1): CutOutResult {
  const { width, height } = img;
  const [br, bg, bb] = borderColour(img);
  const limit = (Math.min(100, Math.max(0, tolerance)) / 100) * MAX_DISTANCE * 0.5;
  const data = new Uint8ClampedArray(img.data);
  const gone = new Uint8Array(width * height);
  const stack: number[] = [];
  const consider = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (gone[p]) return;
    if (data[p * 4 + 3] < 128 || distance(data, p * 4, br, bg, bb) <= limit) { gone[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < width; x += 1) { consider(x, 0); consider(x, height - 1); }
  for (let y = 0; y < height; y += 1) { consider(0, y); consider(width - 1, y); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % width, y = (p - x) / width;
    consider(x + 1, y); consider(x - 1, y); consider(x, y + 1); consider(x, y - 1);
  }
  let removed = 0;
  for (let p = 0; p < gone.length; p += 1) if (gone[p]) removed += 1;
  const share = removed / Math.max(1, gone.length);
  if (share > MAX_REMOVED) return { image: img, removed: share, tooMuch: true };
  for (let p = 0; p < gone.length; p += 1) if (gone[p]) data[p * 4 + 3] = 0;
  // Soften: a kept pixel touching removed background fades by how close its colour is to the background.
  const fade = Math.max(0, Math.round(soften));
  if (fade > 0) {
    const edge: number[] = [];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (gone[p]) continue;
      if ((x > 0 && gone[p - 1]) || (x < width - 1 && gone[p + 1]) || (y > 0 && gone[p - width]) || (y < height - 1 && gone[p + width])) edge.push(p);
    }
    for (const p of edge) {
      const closeness = 1 - Math.min(1, distance(img.data, p * 4, br, bg, bb) / Math.max(1, limit * 2));
      data[p * 4 + 3] = Math.round(data[p * 4 + 3] * (1 - closeness * 0.85));
    }
  }
  return { image: { data, width, height }, removed: share, tooMuch: false };
}

/** The same artwork in one flat colour (white or black), keeping its shape and transparency. For turning a one-colour
 * logo into its light or dark version. */
export function recolour(img: Rgba, colour: 'white' | 'black'): Rgba {
  const value = colour === 'white' ? 255 : 0;
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) { data[i] = value; data[i + 1] = value; data[i + 2] = value; }
  return { data, width: img.width, height: img.height };
}

/** The mean brightness (0 dark, 1 light) of the visible part of the artwork: tells a light mark from a dark one. */
export function artworkBrightness(img: Rgba): number | null {
  let total = 0, weight = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const alpha = img.data[i + 3] / 255;
    if (alpha < 0.1) continue;
    total += ((0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255) * alpha;
    weight += alpha;
  }
  return weight > 0 ? total / weight : null;
}

/**
 * Whether the mark itself is light or dark, ignoring a flat background round it. A black logo on white would otherwise
 * read as "light" because most of the picture is white. Pixels that differ from the border colour are the mark; when there
 * are none (or the artwork is already transparent) it falls back to the brightness of everything visible.
 */
export function markBrightness(img: Rgba): number | null {
  const [br, bg, bb] = borderColour(img);
  let total = 0, count = 0, visible = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 128) continue;
    visible += 1;
    if (Math.hypot(img.data[i] - br, img.data[i + 1] - bg, img.data[i + 2] - bb) < 60) continue;
    total += (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255;
    count += 1;
  }
  if (visible > 0 && count / visible >= 0.005) return total / count;
  return artworkBrightness(img);
}
