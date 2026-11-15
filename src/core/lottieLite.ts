/**
 * A deliberately small reader for the part of the Lottie format a logo animation needs: filled shapes (paths and rounded
 * rectangles) on shape layers, moved, scaled and faded with eased keyframes. Anything else makes it return null, and the
 * caller shows the still logo instead. No code in the file is ever run: it is only read as data.
 */

export interface Keyframe { offset: number; value: number[]; easing: string }
/** A number or two that either stay put or move through keyframes over the whole animation. */
export type Track = { still: number[] } | { keyframes: Keyframe[] };

export interface SplashLayer {
  name: string;
  /** SVG path data, or empty when the layer is a rectangle. */
  path: string;
  rect: { x: number; y: number; width: number; height: number; radius: number } | null;
  fill: string;
  fillOpacity: number;
  evenOdd: boolean;
  anchor: [number, number];
  opacity: Track;
  position: Track;
  scale: Track;
}

export interface SplashAnimation { width: number; height: number; durationMs: number; layers: SplashLayer[] }

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const nums = (value: unknown): number[] | null => {
  const list = Array.isArray(value) ? value : [value];
  return list.every((entry) => typeof entry === 'number' && Number.isFinite(entry)) ? (list as number[]) : null;
};
const first = (value: unknown): number | null => (Array.isArray(value) ? (typeof value[0] === 'number' ? value[0] : null) : typeof value === 'number' ? value : null);

function track(property: unknown, ip: number, op: number, scale = 1): Track | null {
  if (!isObject(property)) return null;
  if (property.a !== 1) {
    const still = nums(property.k);
    return still ? { still: still.map((value) => value * scale) } : null;
  }
  if (!Array.isArray(property.k) || property.k.length === 0) return null;
  const frames: Keyframe[] = [];
  for (let i = 0; i < property.k.length; i += 1) {
    const frame = property.k[i];
    if (!isObject(frame)) return null;
    const value = nums(frame.s);
    if (typeof frame.t !== 'number' || !value) return null;
    let easing = 'linear';
    if (frame.h === 1) easing = 'steps(1, jump-end)';
    else if (isObject(frame.o) && isObject(frame.i)) {
      const out = { x: first(frame.o.x), y: first(frame.o.y) }, into = { x: first(frame.i.x), y: first(frame.i.y) };
      if ([out.x, out.y, into.x, into.y].some((entry) => entry === null)) return null;
      easing = `cubic-bezier(${out.x}, ${out.y}, ${into.x}, ${into.y})`;
    }
    frames.push({ offset: Math.min(1, Math.max(0, (frame.t - ip) / (op - ip))), value: value.map((entry) => entry * scale), easing });
  }
  if (frames.some((frame, index) => index > 0 && frame.offset < frames[index - 1].offset)) return null;
  // Before the first keyframe a value holds still, and after the last it stays where it ended.
  if (frames[0].offset > 0) frames.unshift({ offset: 0, value: frames[0].value, easing: 'linear' });
  if (frames[frames.length - 1].offset < 1) frames.push({ offset: 1, value: frames[frames.length - 1].value, easing: 'linear' });
  return { keyframes: frames };
}

/** One bezier path in Lottie's form (corner points with in and out handles relative to them) as SVG path data. */
function pathData(shape: unknown): string | null {
  if (!isObject(shape) || !isObject(shape.ks) || shape.ks.a !== 0 || !isObject(shape.ks.k)) return null;
  const { v, i, o, c } = shape.ks.k as { v?: unknown; i?: unknown; o?: unknown; c?: unknown };
  if (![v, i, o].every((list) => Array.isArray(list) && list.length > 0 && list.length === (v as unknown[]).length)) return null;
  const point = (list: unknown, index: number): [number, number] | null => {
    const entry = (list as unknown[])[index];
    return Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number' ? [entry[0], entry[1]] : null;
  };
  const count = (v as unknown[]).length;
  const round = (value: number) => Number(value.toFixed(3));
  let d = '';
  for (let index = 0; index < count; index += 1) {
    const here = point(v, index), out = point(o, index);
    if (!here || !out) return null;
    if (index === 0) { d += `M${round(here[0])} ${round(here[1])}`; continue; }
    const before = point(v, index - 1), beforeOut = point(o, index - 1), into = point(i, index);
    if (!before || !beforeOut || !into) return null;
    d += `C${round(before[0] + beforeOut[0])} ${round(before[1] + beforeOut[1])} ${round(here[0] + into[0])} ${round(here[1] + into[1])} ${round(here[0])} ${round(here[1])}`;
  }
  if (c === true) {
    const last = point(v, count - 1), lastOut = point(o, count - 1), start = point(v, 0), startIn = point(i, 0);
    if (!last || !lastOut || !start || !startIn) return null;
    d += `C${round(last[0] + lastOut[0])} ${round(last[1] + lastOut[1])} ${round(start[0] + startIn[0])} ${round(start[1] + startIn[1])} ${round(start[0])} ${round(start[1])}Z`;
  }
  return d;
}

const hex = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');

/** Read a Lottie file into plain shapes and timings, or null when it uses anything this reader does not handle. */
export function parseLottie(json: unknown): SplashAnimation | null {
  if (!isObject(json) || !Array.isArray(json.layers)) return null;
  const { fr, ip, op, w, h } = json as { fr?: unknown; ip?: unknown; op?: unknown; w?: unknown; h?: unknown };
  if (![fr, ip, op, w, h].every((value) => typeof value === 'number' && Number.isFinite(value)) || (op as number) <= (ip as number) || (fr as number) <= 0) return null;
  if (Array.isArray(json.assets) && json.assets.length) return null;
  const layers: SplashLayer[] = [];
  // Lottie lists the top layer first, so draw in reverse.
  for (const layer of [...json.layers].reverse()) {
    if (!isObject(layer) || layer.ty !== 4 || layer.tt || layer.td || layer.hasMask || layer.masksProperties || layer.ef || layer.parent !== undefined) return null;
    if (layer.ip !== ip || layer.op !== op || !isObject(layer.ks) || !Array.isArray(layer.shapes)) return null;
    if (!isObject(layer.ks.r) || layer.ks.r.a !== 0 || first(layer.ks.r.k) !== 0) return null;
    const anchor = track(layer.ks.a, ip as number, op as number);
    const opacity = track(layer.ks.o, ip as number, op as number, 1 / 100);
    const position = track(layer.ks.p, ip as number, op as number);
    const scale = track(layer.ks.s, ip as number, op as number, 1 / 100);
    if (!anchor || !('still' in anchor) || !opacity || !position || !scale) return null;
    let path = '';
    let rect: SplashLayer['rect'] = null;
    let fill: Pick<SplashLayer, 'fill' | 'fillOpacity' | 'evenOdd'> | null = null;
    for (const item of layer.shapes) {
      if (!isObject(item)) return null;
      if (item.ty === 'sh') { const d = pathData(item); if (!d) return null; path += d; }
      else if (item.ty === 'rc') {
        const p = isObject(item.p) ? nums(item.p.k) : null, s = isObject(item.s) ? nums(item.s.k) : null, r = isObject(item.r) ? first(item.r.k) : null;
        if (!p || !s || r === null || isObject(item.p) && item.p.a !== 0 || isObject(item.s) && item.s.a !== 0) return null;
        rect = { x: p[0] - s[0] / 2, y: p[1] - s[1] / 2, width: s[0], height: s[1], radius: r };
      } else if (item.ty === 'fl') {
        const color = isObject(item.c) && item.c.a === 0 ? nums(item.c.k) : null, alpha = isObject(item.o) && item.o.a === 0 ? first(item.o.k) : null;
        if (!color || color.length < 3 || alpha === null) return null;
        fill = { fill: `#${hex(color[0])}${hex(color[1])}${hex(color[2])}`, fillOpacity: alpha / 100, evenOdd: item.r === 2 };
      } else return null;
    }
    if (!fill || (!path && !rect)) return null;
    layers.push({ name: typeof layer.nm === 'string' ? layer.nm : 'layer', path, rect, ...fill, anchor: [anchor.still[0], anchor.still[1]], opacity, position, scale });
  }
  return { width: w as number, height: h as number, durationMs: Math.round((((op as number) - (ip as number)) / (fr as number)) * 1000), layers };
}
