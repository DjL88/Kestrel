import { labToSrgb, srgbToLab } from './iccProfile';

/**
 * A synthetic RGB "printer" profile (lut16, Lab connection), made here so no third-party profile is committed: it prints
 * every colour faithfully up to a chroma of 40 and clips anything more saturated to that.
 */
export function syntheticPrinterProfile(maxChroma = 40, points = 17): Uint8Array {
  const v2 = 65280;
  const lut = (inCh: number, outCh: number, node: (input: number[]) => number[]) => {
    const tables = (count: number) => Array.from({ length: count }, () => [0, 65535]).flat();
    const clut: number[] = [];
    const walk = (prefix: number[]) => {
      if (prefix.length === inCh) { clut.push(...node(prefix.map((i) => i / (points - 1))).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 65535))); return; }
      for (let i = 0; i < points; i++) walk([...prefix, i]);
    };
    walk([]);
    const values = [...tables(inCh), ...clut, ...tables(outCh)];
    const bytes = new Uint8Array(52 + values.length * 2);
    const view = new DataView(bytes.buffer);
    bytes.set([...'mft2'].map((c) => c.charCodeAt(0)), 0);
    view.setUint8(8, inCh); view.setUint8(9, outCh); view.setUint8(10, points);
    [0, 4, 8].forEach((d) => view.setInt32(12 + d * 4, 65536));
    view.setUint16(48, 2); view.setUint16(50, 2);
    values.forEach((v, i) => view.setUint16(52 + i * 2, v));
    return bytes;
  };
  const decodeLab = (n: number[]) => [n[0] * 65535 / v2 * 100, n[1] * 65535 / v2 * 255 - 128, n[2] * 65535 / v2 * 255 - 128];
  const encodeLab = (lab: number[]) => [lab[0] / 100 * v2 / 65535, (lab[1] + 128) / 255 * v2 / 65535, (lab[2] + 128) / 255 * v2 / 65535];
  const b2a = lut(3, 3, (n) => {
    const [L, a, b] = decodeLab(n);
    const chroma = Math.hypot(a, b), k = chroma > maxChroma ? maxChroma / chroma : 1;
    return labToSrgb([L, a * k, b * k]);
  });
  const a2b = lut(3, 3, (rgb) => encodeLab(srgbToLab(rgb)));
  const desc = new Uint8Array(12 + 16);
  desc.set([...'desc'].map((c) => c.charCodeAt(0)), 0);
  new DataView(desc.buffer).setUint32(8, 15);
  desc.set([...'Test paper 40C'].map((c) => c.charCodeAt(0)), 12);
  const tags: Array<[string, Uint8Array]> = [['desc', desc], ['A2B1', a2b], ['B2A1', b2a]];
  let offset = 132 + tags.length * 12;
  const total = offset + tags.reduce((sum, [, data]) => sum + ((data.length + 3) & ~3), 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total);
  view.setUint8(8, 2);
  out.set([...'prtrRGB Lab '].map((c) => c.charCodeAt(0)), 12);
  out.set([...'acsp'].map((c) => c.charCodeAt(0)), 36);
  view.setUint32(128, tags.length);
  tags.forEach(([sig, data], i) => {
    out.set([...sig].map((c) => c.charCodeAt(0)), 132 + i * 12);
    view.setUint32(132 + i * 12 + 4, offset); view.setUint32(132 + i * 12 + 8, data.length);
    out.set(data, offset);
    offset += (data.length + 3) & ~3;
  });
  return out;
}
