import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react';
import { histogramBars, type Histogram as HistogramData } from '../core/histogram';

const percent = (fraction: number) => (fraction === 0 ? '0%' : fraction < 0.001 ? '<0.1%' : `${(fraction * 100).toFixed(1)}%`);

/** Brightness histogram with separate red, green and blue lines. Clipping is stated in words and shapes, never colour alone. */
export function Histogram({ data }: { data: HistogramData | null }) {
  if (!data) return null;
  const count = 64;
  const bars = histogramBars(data.luma, count);
  const line = (bins: Uint32Array) => histogramBars(bins, count)
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${((index + 0.5) / count) * 100},${40 - value * 38}`).join(' ');
  const shadows = data.shadowClip > 0.005;
  const highlights = data.highlightClip > 0.005;
  return (
    <figure className="px-1 pb-2" aria-label="Histogram">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-16 w-full rounded bg-black/30" role="img"
        aria-label={`Brightness histogram. Shadows clipped ${percent(data.shadowClip)}, highlights clipped ${percent(data.highlightClip)}.`}>
        {bars.map((value, index) => (
          <rect key={index} x={(index / count) * 100} width={100 / count} y={40 - value * 38} height={value * 38} fill="currentColor" className="text-zinc-400/60" />
        ))}
        <path d={line(data.red)} fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="2 1" vectorEffect="non-scaling-stroke" className="text-zinc-100" />
        <path d={line(data.blue)} fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="0.5 1" vectorEffect="non-scaling-stroke" className="text-sky-300" />
      </svg>
      <figcaption className="flex justify-between pt-1 text-xs text-zinc-400">
        <span className={`inline-flex items-center gap-1 ${shadows ? 'font-semibold text-zinc-100' : ''}`}>
          <ArrowDownToLine className="h-3 w-3" aria-hidden="true" />Shadows clipped {percent(data.shadowClip)}
        </span>
        <span className={`inline-flex items-center gap-1 ${highlights ? 'font-semibold text-zinc-100' : ''}`}>
          Highlights clipped {percent(data.highlightClip)}<ArrowUpToLine className="h-3 w-3" aria-hidden="true" />
        </span>
      </figcaption>
    </figure>
  );
}
