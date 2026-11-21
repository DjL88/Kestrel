import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { exportCompactLabels as compact } from '../i18n/exportCompactLabels';
import type { PhotoFrame } from '../core/types';
import type { ExportFormat, BarStyle } from '../core/exportFormats';
import type { FocusPoint } from '../core/exportFraming';
import type { OverlayOptions } from '../core/exportOverlay';
import { formatLabel } from '../i18n/areas/export/labels';
import { exportText as t } from '../i18n/areas/export';
import { ExportPreviewTile } from './ExportPreviewTile';
import type { ProofChoice } from '../core/exportProofSelection';

interface Props {
  frames: readonly PhotoFrame[];
  formats: readonly ExportFormat[];
  sources: Readonly<Record<string, HTMLImageElement>>;
  choice: ProofChoice | null;
  failedPhotoId: string | null;
  onRetry: () => void;
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const frame = props.frames.find(item => item.id === props.choice?.photoId);
  const format = props.formats.find(item => item.id === props.choice?.destinationId);
  return (
    <aside aria-label={t.proof.title} className="z-10 shrink-0 border-b border-white/15 bg-kestrel-raised px-3 py-1 sm:py-2">
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="grid min-w-0 grid-cols-1 items-center gap-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="flex min-w-0 items-center justify-between gap-1">
            <strong className="min-w-0 text-sm font-medium text-zinc-100">{t.proof.title}</strong>
            <button type="button" aria-expanded={mobileOpen} aria-controls="export-mobile-proof"
              onClick={() => setMobileOpen(value => !value)}
              className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-xs text-zinc-200 hover:bg-white/10 sm:hidden">
              {mobileOpen ? compact.hideProof : compact.showProof}
              <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${mobileOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {props.frames.length > 1 && <label className={`flex min-w-0 max-w-full items-center gap-2 ${mobileOpen ? '' : 'max-sm:hidden'}`}>
            <span className="text-zinc-300">{t.proof.photo}</span>
            <select aria-label={t.proof.choosePhoto} className="min-h-11 min-w-0 w-full max-w-full sm:max-w-44 rounded-md border border-white/20 bg-[#15171C] px-2 text-zinc-100"
              value={frame?.id ?? ''} onChange={event => props.onChoosePhoto(event.target.value)}>
              {props.frames.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.filename}</option>)}
            </select>
          </label>}
          {props.formats.length > 0 && <label className={`flex min-w-0 items-center gap-2 ${mobileOpen ? '' : 'max-sm:hidden'}`}>
            <span className="text-zinc-300">{t.proof.output}</span>
            <select aria-label={t.proof.chooseOutput} className="min-h-11 min-w-0 w-full max-w-full sm:max-w-48 rounded-md border border-white/20 bg-[#15171C] px-2 text-zinc-100"
              value={format?.id ?? ''} onChange={event => props.onChooseDestination(event.target.value)}>
              {props.formats.map(item => <option key={item.id} value={item.id}>{formatLabel(item)}</option>)}
            </select>
          </label>}
        </div>
        <div id="export-mobile-proof" className={mobileOpen ? '' : 'max-sm:hidden'}>
        {(!narrow || mobileOpen) && (frame && format && props.sources[frame.id] ? (
          <div className="mx-auto w-full max-w-[min(100%,32rem)] [&_figure>div:first-child>div]:!h-[clamp(9rem,28dvh,17rem)] sm:[&_figure>div:first-child>div]:!h-[clamp(12rem,34dvh,23rem)]">
            <ExportPreviewTile key={frame.id + '|' + format.id} frame={frame} source={props.sources[frame.id]}
              format={format} bars={props.bars} anchor={props.anchorFor(frame, format)}
              onAnchor={point => props.onAnchor(frame, format, point)}
              zoom={props.zoomFor(frame, format)} onZoom={zoom => props.onZoom(frame, format, zoom)}
              overlay={props.overlay} platform={format.platform} />
          </div>
        ) : frame && format && props.failedPhotoId === frame.id ? (
          <div role="alert" className="flex flex-wrap items-center justify-center gap-2 text-sm text-zinc-200">
            <span>{t.proof.loadFailed}</span>
            <button type="button" className="min-h-11 rounded-md border border-white/25 px-3 hover:bg-white/10"
              onClick={props.onRetry}>{t.proof.retry}</button>
          </div>
        ) : <p role="status" className="text-sm text-zinc-300">{frame && format ? t.proof.loading : t.proof.choose}</p>)}
        <p className="hidden text-center text-xs text-zinc-400 sm:block">{t.proof.resolution}</p>
        </div>
      </div>
    </aside>
  );
}
