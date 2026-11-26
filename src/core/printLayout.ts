/** Paper sizes in millimetres (short side, long side). Names are as printed on the packet, so they are not translated. */
export const PRINT_PAPERS = {
  '6x4': { label: '6 × 4 in', mm: [101.6, 152.4] },
  A6: { label: 'A6', mm: [105, 148] },
  '7x5': { label: '7 × 5 in', mm: [127, 177.8] },
  A5: { label: 'A5', mm: [148, 210] },
  '10x8': { label: '10 × 8 in', mm: [203.2, 254] },
  A4: { label: 'A4', mm: [210, 297] },
  Letter: { label: 'US Letter', mm: [215.9, 279.4] },
  A3: { label: 'A3', mm: [297, 420] },
  'A3+': { label: 'A3+ (13 × 19 in)', mm: [329, 483] },
} as const;
export type PrintPaper = keyof typeof PRINT_PAPERS;

export interface PrintLayout {
  orientation: 'portrait' | 'landscape';
  /** The page, and the picture centred on it, in millimetres. */
  pageMm: { width: number; height: number };
  imageMm: { width: number; height: number };
  /** Pixels per inch the picture prints at. Never raised by resampling: a small picture is simply printed at fewer ppi. */
  ppi: number;
}

/** Fit the picture inside the paper less an even margin, turning the page to suit the picture. */
export function printLayout(pixelWidth: number, pixelHeight: number, paper: PrintPaper, marginMm = 10): PrintLayout {
  if (!(pixelWidth > 0 && pixelHeight > 0)) throw new RangeError('The picture has no size.');
  const entry = PRINT_PAPERS[paper];
  if (!entry) throw new RangeError('Unknown paper size.');
  const [short, long] = entry.mm;
  const orientation = pixelWidth > pixelHeight ? 'landscape' : 'portrait';
  const page = orientation === 'landscape' ? { width: long, height: short } : { width: short, height: long };
  const room = { width: Math.max(1, page.width - 2 * marginMm), height: Math.max(1, page.height - 2 * marginMm) };
  const scale = Math.min(room.width / pixelWidth, room.height / pixelHeight);
  const imageMm = { width: pixelWidth * scale, height: pixelHeight * scale };
  return { orientation, pageMm: page, imageMm, ppi: Math.round(pixelWidth / (imageMm.width / 25.4)) };
}
