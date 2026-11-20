import type { PhotoFrame } from '../core/types';
import type { ExportFormat, BarStyle } from '../core/exportFormats';
import type { FocusPoint } from '../core/exportFraming';
import type { OverlayOptions } from '../core/exportOverlay';
import { formatLabel } from '../i18n/areas/export/labels';
import { ExportPreviewTile } from './ExportPreviewTile';
import type { ProofChoice } from '../core/exportProofSelection';

interface Props {
  frames: readonly PhotoFrame[];
  formats: readonly ExportFormat[];
  sources: Readonly<Record<string, HTMLImageElement>>;
  choice: ProofChoice | null;
  onChoosePhoto: (id: string) => void;
  onChooseDestination: (id: string) => void;
  bars: BarStyle;
  overlay: OverlayOptions;
  anchorFor: (frame: PhotoFrame, format: ExportFormat) => FocusPoint;
  zoomFor: (frame: PhotoFrame, format: ExportFormat) => number;
  onAnchor: (frame: PhotoFrame, format: ExportFormat, point: FocusPoint) => void;
  onZoom: (frame: PhotoFrame, format: ExportFormat, zoom: number) => void;
}
/** Pinned above the scrolling form. Uses the actual export preview renderer, not a placeholder thumbnail. */
export function ExportProofDock(props: Props) {
  const frame = props.frames.find(item => item.id === props.choice?.photoId);
  const format = props.formats.find(item => item.id === props.choice?.destinationId);
  return (
    <aside aria-label="Export proof" className="z-10 shrink-0 border-b border-white/15 bg-kestrel-raised px-3 py-2">
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <strong className="mr-auto text-sm font-medium text-zinc-100">Export proof</strong>
          {props.frames.length > 1 && <label className="flex min-w-0 items-center gap-2">
            <span className="text-zinc-300">Photo</span>
            <select aria-label="Proof photo" className="min-h-10 max-w-40 rounded-md border border-white/20 bg-[#15171C] px-2 text-zinc-100"
              value={frame?.id ?? ''} onChange={event => props.onChoosePhoto(event.target.value)}>
              {props.frames.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.filename}</option>)}
            </select>
          </label>}
          {props.formats.length > 0 && <label className="flex min-w-0 items-center gap-2">
            <span className="text-zinc-300">Output</span>
            <select aria-label="Proof output" className="min-h-10 max-w-44 rounded-md border border-white/20 bg-[#15171C] px-2 text-zinc-100"
              value={format?.id ?? ''} onChange={event => props.onChooseDestination(event.target.value)}>
              {props.formats.map(item => <option key={item.id} value={item.id}>{formatLabel(item)}</option>)}
            </select>
          </label>}
        </div>
        {frame && format ? (
          <div className="mx-auto w-full max-w-[18rem] [&_figure>div:first-child>div]:!h-[min(22dvh,11rem)]">
            <ExportPreviewTile key={frame.id + '|' + format.id} frame={frame} source={props.sources[frame.id]}
              format={format} bars={props.bars} anchor={props.anchorFor(frame, format)}
              onAnchor={point => props.onAnchor(frame, format, point)}
              zoom={props.zoomFor(frame, format)} onZoom={zoom => props.onZoom(frame, format, zoom)}
              overlay={props.overlay} platform={format.platform} />
          </div>
        ) : <p role="status" className="text-sm text-zinc-300">Choose an output to see its proof.</p>}
        <p className="text-center text-xs text-zinc-400">Screen-resolution proof only. Final export size and quality may differ; check the saved file.</p>
      </div>
    </aside>
  );
}
