import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react';
import { histogramBars, type Histogram as HistogramData } from '../core/histogram';
import { interpretHistogram } from '../core/histogramNotes';

const percent = (fraction: number) => (fraction === 0 ? '0%' : fraction < 0.001 ? '<0.1%' : `${(fraction * 100).toFixed(1)}%`);

/**
 * Brightness histogram with separate red, green and blue lines. Clipping is stated in words and shapes, never colour alone.
 * With `teach`, it also says what the shape means and what to try, so the histogram becomes something to learn from.
 */
export function Histogram({ data, teach = false }: { data: HistogramData | null; teach?: boolean }) {
  if (!data) return null;
  const count = 64;
  const bars = histogramBars(data.luma, count);
  const line = (bins: Uint32Array) => histogramBars(bins, count)
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${((index + 0.5) / count) * 100},${40 - value * 38}`).join(' ');
  const shadows = data.shadowClip > 0.005;
  const highlights = data.highlightClip > 0.005;
  const notes = teach ? interpretHistogram(data) : [];
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
      {teach && (
        <div aria-hidden="true" className="flex justify-between pt-0.5 text-[11px] text-zinc-500">
          <span>Shadows</span><span>Midtones</span><span>Highlights</span>
        </div>
      )}
      <figcaption className="flex justify-between pt-1 text-xs text-zinc-400">
        <span className={`inline-flex items-center gap-1 ${shadows ? 'font-semibold text-zinc-100' : ''}`}>
          <ArrowDownToLine className="h-3 w-3" aria-hidden="true" />Shadows clipped {percent(data.shadowClip)}
        </span>
        <span className={`inline-flex items-center gap-1 ${highlights ? 'font-semibold text-zinc-100' : ''}`}>
          Highlights clipped {percent(data.highlightClip)}<ArrowUpToLine className="h-3 w-3" aria-hidden="true" />
        </span>
      </figcaption>
      {teach && (
        <>
          <details className="pt-1 text-xs text-zinc-400">
            <summary className="flex min-h-11 cursor-pointer items-center">How to read this</summary>
            <p className="pb-1">Left is dark, right is bright. Taller means more of the picture is at that brightness. The dashed lines show red and blue. Anything piled against either edge has lost detail.</p>
          </details>
          <ul className="space-y-2 pt-1" aria-label="What the histogram says">
            {notes.map((note) => (
              <li key={note.headline} className="rounded-md bg-black/25 p-2 text-sm">
                <p className="font-medium text-zinc-100">{note.headline}</p>
                <p className="text-zinc-300">{note.meaning}</p>
                <p className="text-zinc-400"><span className="font-medium">Try:</span> {note.tryThis}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}
