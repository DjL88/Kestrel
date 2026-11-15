import { useEffect, useRef, useState } from 'react';
import { applyCanvasPhotoEdit, DEFAULT_EDIT } from '../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto } from '../core/photoFraming';
import { loadExportSource } from '../providers/browserExport';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import type { PhotoFrame } from '../core/types';

export function PhotoHistogram({ frame, provider }: { frame: PhotoFrame; provider: BrowserPreviewProvider }) {
  const graph = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState<boolean>();
  useEffect(() => {
    let active = true;
    setAvailable(undefined);
    async function draw() {
      const source = await loadExportSource(frame, provider);
      if (!active) return;
      const sample = document.createElement('canvas');
      drawFramedPhoto(source, sample, frame.framing ?? DEFAULT_FRAMING, {
        scale: Math.min(1, 256 / Math.max(source.naturalWidth, source.naturalHeight)),
      });
      applyCanvasPhotoEdit(sample, frame.edit ?? DEFAULT_EDIT);
      const { data } = sample.getContext('2d')!.getImageData(0, 0, sample.width, sample.height);
      const bins = [new Uint32Array(64), new Uint32Array(64), new Uint32Array(64)];
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        bins[0][data[i] >> 2]++;
        bins[1][data[i + 1] >> 2]++;
        bins[2][data[i + 2] >> 2]++;
      }
      const canvas = graph.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      const peak = Math.max(1, ...bins.flatMap((channel) => [...channel]));
      context.clearRect(0, 0, canvas.width, canvas.height);
      bins.forEach((channel, index) => {
        context.strokeStyle = ['#fca5a5', '#86efac', '#93c5fd'][index];
        context.beginPath();
        channel.forEach((count, bin) => {
          const x = (bin / 63) * (canvas.width - 2) + 1;
          const y = canvas.height - 1 - (count / peak) * (canvas.height - 3);
          if (bin) context.lineTo(x, y);
          else context.moveTo(x, y);
        });
        context.stroke();
      });
      setAvailable(true);
    }
    void draw().catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [frame.id, frame.edit, frame.framing, provider]);

  return <figure className="mt-3 rounded-lg border border-white/10 bg-black/25 p-2.5">
    <figcaption className="mb-1 text-xs font-medium text-zinc-300">RGB histogram · Edited preview</figcaption>
    <canvas ref={graph} role="img" aria-label="Red, green and blue tonal distribution from dark to bright"
      width={320} height={96} className="w-full" hidden={available !== true} />
    {available !== true && <p className="text-xs text-zinc-400">{available === false ? 'Preview unavailable' : 'Reading preview…'}</p>}
  </figure>;
}
