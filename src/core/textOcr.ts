/**
 * The pure parts of reading painted text with PP-OCRv5 mobile (PaddleOCR, Apache-2.0): turning the detector's
 * probability map into text boxes, and the recogniser's per-step scores into text. No model is loaded here.
 * Checked against PaddleOCR's own pipeline on synthetic markings (tools/registers/ocr_reference.py).
 */
export const OCR_DETECT = { longSide: 960, threshold: 0.3, boxThreshold: 0.6, unclip: 1.5, minPixels: 9, maxBoxes: 40 } as const;
export const OCR_RECOGNISE = { height: 48, maxWidth: 1280 } as const;

export interface TextBox { x: number; y: number; width: number; height: number; score: number }

/** The detector's input size for a picture: the long side at most 960, both sides multiples of 32. */
export function detectorSize(width: number, height: number): { width: number; height: number } {
  const scale = OCR_DETECT.longSide / Math.max(width, height);
  const round = (value: number) => Math.max(32, Math.round((value * scale) / 32) * 32);
  return { width: round(width), height: round(height) };
}

/**
 * Text boxes from the detector's map (`map` is `mapWidth` × `mapHeight`, values 0–1), in the picture's own pixels.
 * Each connected patch above the threshold becomes one upright box, grown as PaddleOCR's "unclip" does, and kept only
 * when its mean score is high enough. Strongest first, at most `maxBoxes`.
 */
export function textBoxes(map: ArrayLike<number>, mapWidth: number, mapHeight: number, pictureWidth: number, pictureHeight: number): TextBox[] {
  const seen = new Uint8Array(mapWidth * mapHeight);
  const stack: number[] = [];
  const boxes: TextBox[] = [];
  const sx = pictureWidth / mapWidth, sy = pictureHeight / mapHeight;
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] || !(map[start] > OCR_DETECT.threshold)) continue;
    let x0 = mapWidth, y0 = mapHeight, x1 = 0, y1 = 0, sum = 0, count = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const at = stack.pop()!;
      const x = at % mapWidth, y = (at - x) / mapWidth;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
      sum += map[at]; count += 1;
      const next = [x > 0 ? at - 1 : -1, x < mapWidth - 1 ? at + 1 : -1, y > 0 ? at - mapWidth : -1, y < mapHeight - 1 ? at + mapWidth : -1];
      for (const n of next) if (n >= 0 && !seen[n] && map[n] > OCR_DETECT.threshold) { seen[n] = 1; stack.push(n); }
    }
    const score = sum / count;
    if (count < OCR_DETECT.minPixels || score < OCR_DETECT.boxThreshold) continue;
    const w = x1 - x0, h = y1 - y0;
    const grow = (w * h * OCR_DETECT.unclip) / (2 * (w + h));
    const left = Math.max(0, (x0 - grow) * sx), top = Math.max(0, (y0 - grow) * sy);
    const right = Math.min(pictureWidth, (x1 + grow) * sx), bottom = Math.min(pictureHeight, (y1 + grow) * sy);
    if (right - left >= 4 && bottom - top >= 4) boxes.push({ x: left, y: top, width: right - left, height: bottom - top, score });
  }
  return boxes.sort((a, b) => b.score - a.score).slice(0, OCR_DETECT.maxBoxes);
}

/** The recogniser's input width for a crop, keeping its shape at 48 px high. */
export function recogniserWidth(width: number, height: number): number {
  return Math.min(OCR_RECOGNISE.maxWidth, Math.max(16, Math.round((OCR_RECOGNISE.height * width) / Math.max(1, height))));
}

/**
 * Greedy CTC decoding: the best class at each step, repeats collapsed, the blank (class 0) dropped. `characters` is the
 * recogniser's dictionary (class i is characters[i - 1]). Confidence is the mean score of the characters kept.
 */
export function decodeText(scores: ArrayLike<number>, steps: number, classes: number, characters: readonly string[]): { text: string; confidence: number } {
  let text = '', total = 0, kept = 0, last = 0;
  for (let t = 0; t < steps; t += 1) {
    let best = 0, bestScore = -Infinity;
    for (let c = 0; c < classes; c += 1) {
      const value = scores[t * classes + c];
      if (value > bestScore) { bestScore = value; best = c; }
    }
    if (best !== 0 && best !== last && characters[best - 1] !== undefined) { text += characters[best - 1]; total += bestScore; kept += 1; }
    last = best;
  }
  return { text, confidence: kept ? total / kept : 0 };
}
