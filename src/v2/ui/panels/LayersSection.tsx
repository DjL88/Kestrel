import React from 'react';
import type { OverlaySettings, Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';
import { layerImage } from '../../../core/layerAssetVault';
import { LAYER_BLENDS, LAYER_SHAPES, type PhotoLayer } from '../../../core/layers';

const T = STRINGS.layers;

interface Props {
  photo: Photo;
  overlay: OverlaySettings;
  /** Other photos in the project that can be copied in as a layer. */
  projectPhotos: Array<{ id: string; filename: string }>;
  onShowText: () => void;
  onShowWatermark: () => void;
  onAddImageLayer: (photoId: string) => Promise<void>;
  onAddPhotoLayer: (photoId: string, sourcePhotoId: string) => Promise<void>;
  onUpdateLayer: (photoId: string, layerId: string, patch: Partial<Omit<PhotoLayer, 'id' | 'assetId' | 'aspect'>>) => void;
  onRemoveLayer: (photoId: string, layerId: string) => void;
  onMoveLayer: (photoId: string, layerId: string, direction: -1 | 1) => void;
  calmView: boolean;
}

/** Whether this device has each layer's image, so a missing one is named rather than silently left out. */
function useMissing(layers: readonly PhotoLayer[]): Set<string> {
  const [missing, setMissing] = React.useState<Set<string>>(new Set());
  const key = layers.map((layer) => layer.assetId).join(',');
  React.useEffect(() => {
    let live = true;
    void Promise.all(layers.map(async (layer) => [layer.assetId, await layerImage(layer.assetId)] as const)).then((found) => {
      if (live) setMissing(new Set(found.filter(([, image]) => !image).map(([id]) => id)));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return missing;
}

function Slider({ id, label, help, value, min, max, step = 1, unit = '', calmView, onChange }: {
  id: string; label: string; help: string; value: number; min: number; max: number; step?: number; unit?: string; calmView: boolean; onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <label htmlFor={id} className="text-xs font-medium text-[var(--text-primary)]">{label}</label>
          <InfoPopover title={label} body={help} />
        </div>
        {!calmView && <span className="font-mono text-[0.6875rem] tabular-nums text-[var(--text-secondary)]">{`${Math.round(value)}${unit}`}</span>}
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="inflight-slider" />
    </div>
  );
}

/**
 * A small map of the photo with the layer's outline on it. Drag the outline (or use the arrow keys) to move the layer;
 * the move is saved as one step when you let go, so Undo takes it back in one go.
 */
function PositionPad({ layer, frameAspect, onMove }: { layer: PhotoLayer; frameAspect: number; onMove: (x: number, y: number) => void }) {
  const pad = React.useRef<HTMLDivElement>(null);
  const [live, setLive] = React.useState<{ x: number; y: number } | null>(null);
  const start = React.useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const at = live ?? { x: layer.x, y: layer.y };
  const clamp = (v: number) => Math.min(1.2, Math.max(-0.2, v));
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = pad.current!.getBoundingClientRect();
    // Clicking away from the outline brings the layer's centre there; dragging the outline keeps where you grabbed it.
    const onOutline = (event.target as HTMLElement).dataset.outline === 'true';
    const x = onOutline ? layer.x : (event.clientX - box.left) / box.width;
    const y = onOutline ? layer.y : (event.clientY - box.top) / box.height;
    start.current = { px: event.clientX, py: event.clientY, x, y };
    setLive({ x: clamp(x), y: clamp(y) });
    pad.current!.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const box = pad.current!.getBoundingClientRect();
    setLive({ x: clamp(start.current.x + (event.clientX - start.current.px) / box.width), y: clamp(start.current.y + (event.clientY - start.current.py) / box.height) });
  };
  const onPointerUp = () => {
    if (start.current && live) onMove(Math.round(live.x * 1000) / 1000, Math.round(live.y * 1000) / 1000);
    start.current = null;
    setLive(null);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onMove(clamp(layer.x + move[0]), clamp(layer.y + move[1]));
  };
  const heightShare = (layer.width * layer.aspect) / frameAspect;
  return (
    <div ref={pad} role="slider" tabIndex={0} aria-label={T.moveLabel.replace('{name}', layer.label)}
      aria-valuetext={`${Math.round(at.x * 100)}% ${T.across}, ${Math.round(at.y * 100)}% ${T.down}`} aria-valuenow={Math.round(at.x * 100)}
      onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      data-testid="layer-position-pad"
      className="relative w-full touch-none select-none overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]"
      style={{ aspectRatio: `${1 / frameAspect}` }}>
      <div aria-hidden="true" data-outline="true" className="absolute cursor-grab border-2 border-dashed border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]"
        style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, width: `${layer.width * 100}%`, height: `${heightShare * 100}%`,
          transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`, borderRadius: layer.shape === 'oval' ? '50%' : undefined }} />
    </div>
  );
}

const rowClass = (on: boolean) => `flex min-h-10 items-center gap-2 rounded-[var(--radius-sm)] border px-2 text-xs ${on ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]' : 'border-[var(--border-subtle)] bg-[var(--bg-input)]'}`;
const smallButton = 'grid h-7 w-7 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-40';

/**
 * The photo's layers as one stack, top first: text and watermark always on top, then image layers, then the photo.
 * Image layers are part of the picture (in every view and export); text and watermark are drawn on each format above them.
 */
export default function LayersSection({ photo, overlay, projectPhotos, onShowText, onShowWatermark, onAddImageLayer, onAddPhotoLayer, onUpdateLayer, onRemoveLayer, onMoveLayer, calmView }: Props) {
  const layers = overlay.layers ?? [];
  const [selectedId, setSelectedId] = React.useState<string | null>(layers.at(-1)?.id ?? null);
  const [picking, setPicking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const missing = useMissing(layers);
  const selected = layers.find((layer) => layer.id === selectedId) ?? null;
  const previousCount = React.useRef(layers.length);
  React.useEffect(() => {
    // A newly added layer becomes the selected one.
    if (layers.length > previousCount.current) setSelectedId(layers.at(-1)!.id);
    previousCount.current = layers.length;
  }, [layers]);
  const original = photo.sizes.find((size) => size.id === 'orig-3x2');
  const frameAspect = original && original.width > 0 && original.height > 0 ? original.height / original.width : 2 / 3;
  const others = projectPhotos.filter((candidate) => candidate.id !== photo.id);
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work(); } finally { setBusy(false); } };
  const update = (patch: Partial<Omit<PhotoLayer, 'id' | 'assetId' | 'aspect'>>) => selected && onUpdateLayer(photo.id, selected.id, patch);

  return (
    <div className="space-y-3" data-testid="layers">
      <div className="flex items-center gap-1">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{T.heading}</h3>
        <InfoPopover title={T.heading} body={T.help} />
      </div>

      <ol aria-label={T.stackLabel} className="space-y-1">
        <li className={rowClass(false)}>
          <BrandIcon name="text" size={14} />
          <button type="button" className="flex-1 text-left text-[var(--text-primary)] hover:underline" onClick={onShowText}>{T.text}</button>
          <span className="text-[0.6875rem] text-[var(--text-muted)]">{overlay.textEnabled ? T.on : T.off}</span>
        </li>
        <li className={rowClass(false)}>
          <BrandIcon name="watermark" size={14} />
          <button type="button" className="flex-1 text-left text-[var(--text-primary)] hover:underline" onClick={onShowWatermark}>{T.watermark}</button>
          <span className="text-[0.6875rem] text-[var(--text-muted)]">{overlay.watermarkEnabled ? T.on : T.off}</span>
        </li>
        {[...layers].reverse().map((layer, reversedIndex) => {
          const index = layers.length - 1 - reversedIndex;
          const isSelected = layer.id === selectedId;
          return (
            <li key={layer.id} className={rowClass(isSelected)}>
              <button type="button" aria-pressed={isSelected} onClick={() => setSelectedId(layer.id)}
                className="min-w-0 flex-1 truncate text-left text-[var(--text-primary)]">
                {layer.label || T.untitled}
                {layer.hidden && <span className="text-[var(--text-muted)]"> · {T.hiddenTag}</span>}
                {missing.has(layer.assetId) && <span className="text-[var(--status-warning,#b45309)]"> · {T.missingTag}</span>}
              </button>
              <button type="button" className={smallButton} aria-label={`${layer.hidden ? T.show : T.hide} ${layer.label}`} title={layer.hidden ? T.show : T.hide}
                onClick={() => onUpdateLayer(photo.id, layer.id, { hidden: !layer.hidden })}>
                <span className={layer.hidden ? 'opacity-40' : ''}><BrandIcon name="eye" size={14} /></span>
              </button>
              <button type="button" className={smallButton} aria-label={`${T.moveUp} ${layer.label}`} title={T.moveUp} disabled={index === layers.length - 1}
                onClick={() => onMoveLayer(photo.id, layer.id, 1)}>
                <span aria-hidden="true">↑</span>
              </button>
              <button type="button" className={smallButton} aria-label={`${T.moveDown} ${layer.label}`} title={T.moveDown} disabled={index === 0}
                onClick={() => onMoveLayer(photo.id, layer.id, -1)}>
                <span aria-hidden="true">↓</span>
              </button>
            </li>
          );
        })}
        <li className={`${rowClass(false)} text-[var(--text-secondary)]`}>
          <BrandIcon name="image" size={14} />
          <span className="flex-1">{T.photo}</span>
          <span className="text-[0.6875rem] text-[var(--text-muted)]">{T.photoNote}</span>
        </li>
      </ol>

      {missing.size > 0 && <p role="status" className="text-[0.6875rem] leading-snug text-[var(--text-secondary)]">{T.missingHelp}</p>}

      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" disabled={busy} onClick={() => void run(() => onAddImageLayer(photo.id))}
          className="min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--brand-accent)] disabled:opacity-50">
          {T.addImage}
        </button>
        <button type="button" disabled={busy || others.length === 0} aria-expanded={picking} onClick={() => setPicking((open) => !open)}
          className="min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--brand-accent)] disabled:opacity-50">
          {T.addPhoto}
        </button>
      </div>
      {busy && <p role="status" className="text-[0.6875rem] text-[var(--text-secondary)]">{T.adding}</p>}
      {picking && (
        <div className="space-y-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2">
          <p className="text-[0.6875rem] leading-snug text-[var(--text-secondary)]">{T.photoCopyNote}</p>
          <ul aria-label={T.addPhoto} className="max-h-40 space-y-0.5 overflow-y-auto">
            {others.map((candidate) => (
              <li key={candidate.id}>
                <button type="button" className="w-full truncate rounded px-1.5 py-1 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
                  onClick={() => { setPicking(false); void run(() => onAddPhotoLayer(photo.id, candidate.id)); }}>
                  {candidate.filename}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selected && (
        <section aria-label={`${T.settingsFor} ${selected.label}`} className="space-y-3 border-t border-[var(--border-subtle)] pt-3" data-testid="layer-settings">
          <p className="text-[0.6875rem] leading-snug text-[var(--text-secondary)]">{T.dragHint}</p>
          <PositionPad layer={selected} frameAspect={frameAspect} onMove={(x, y) => update({ x, y })} />
          <Slider id="layer-size" label={T.size} help={T.sizeHelp} value={selected.width * 100} min={2} max={300} unit="%" calmView={calmView} onChange={(v) => update({ width: v / 100 })} />
          <Slider id="layer-rotation" label={T.rotation} help={T.rotationHelp} value={selected.rotation} min={-180} max={180} unit="°" calmView={calmView} onChange={(v) => update({ rotation: v })} />
          <Slider id="layer-opacity" label={T.opacity} help={T.opacityHelp} value={selected.opacity * 100} min={0} max={100} unit="%" calmView={calmView} onChange={(v) => update({ opacity: v / 100 })} />
          <Slider id="layer-soft-edge" label={T.softEdge} help={T.softEdgeHelp} value={selected.softEdge * 200} min={0} max={100} calmView={calmView} onChange={(v) => update({ softEdge: v / 200 })} />
          <div className="space-y-1">
            <span id="layer-shape-label" className="text-xs font-medium text-[var(--text-primary)]">{T.shape}</span>
            <div role="radiogroup" aria-labelledby="layer-shape-label" className="grid grid-cols-2 gap-1">
              {LAYER_SHAPES.map((shape) => (
                <button key={shape} type="button" role="radio" aria-checked={selected.shape === shape} onClick={() => update({ shape })}
                  className={`min-h-8 rounded-[var(--radius-sm)] border px-1 text-[0.6875rem] ${selected.shape === shape ? 'border-[var(--brand-accent)] text-[var(--brand-accent)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
                  {T.shapes[shape]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span id="layer-blend-label" className="text-xs font-medium text-[var(--text-primary)]">{T.blend}</span>
              <InfoPopover title={T.blend} body={T.blendHelp} />
            </div>
            <div role="radiogroup" aria-labelledby="layer-blend-label" className="grid grid-cols-3 gap-1">
              {LAYER_BLENDS.map((blend) => (
                <button key={blend} type="button" role="radio" aria-checked={selected.blend === blend} onClick={() => update({ blend })}
                  className={`min-h-8 rounded-[var(--radius-sm)] border px-1 text-[0.6875rem] ${selected.blend === blend ? 'border-[var(--brand-accent)] text-[var(--brand-accent)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
                  {T.blends[blend]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1" data-testid="layer-mask">
            <div className="flex items-center gap-1">
              <label htmlFor="layer-mask" className="text-xs font-medium text-[var(--text-primary)]">{T.mask}</label>
              <InfoPopover title={T.mask} body={T.maskHelp} />
            </div>
            <select id="layer-mask" value={photo.masks.some((m) => m.id === selected.maskId) ? selected.maskId : ''}
              onChange={(e) => update({ maskId: e.target.value || undefined, ...(e.target.value ? {} : { maskInvert: undefined }) })}
              className="min-h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]">
              <option value="">{T.maskNone}</option>
              {photo.masks.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {!photo.masks.length && <p className="text-[0.6875rem] leading-snug text-[var(--text-muted)]">{T.maskNoneYet}</p>}
            {selected.maskId && !photo.masks.some((m) => m.id === selected.maskId) && (
              <p role="status" className="text-[0.6875rem] leading-snug text-[var(--text-secondary)]">{T.maskGone}</p>
            )}
            {photo.masks.some((m) => m.id === selected.maskId) && (
              <div role="radiogroup" aria-label={T.maskWhere} className="grid grid-cols-2 gap-1">
                {([[false, T.maskInside], [true, T.maskOutside]] as const).map(([invert, label]) => (
                  <button key={String(invert)} type="button" role="radio" aria-checked={!!selected.maskInvert === invert}
                    onClick={() => update({ maskInvert: invert || undefined })}
                    className={`min-h-8 rounded-[var(--radius-sm)] border px-1 text-[0.6875rem] ${!!selected.maskInvert === invert ? 'border-[var(--brand-accent)] text-[var(--brand-accent)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => update({ x: 0.5, y: 0.5, rotation: 0 })}
              className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 py-1 text-[0.6875rem] text-[var(--text-secondary)] hover:border-[var(--border-default)]">{T.centre}</button>
            <button type="button" onClick={() => update({ x: 0.5, y: 0.5, width: 1, rotation: 0 })}
              className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 py-1 text-[0.6875rem] text-[var(--text-secondary)] hover:border-[var(--border-default)]">{T.fillWidth}</button>
            <button type="button" onClick={() => { onRemoveLayer(photo.id, selected.id); setSelectedId(null); }}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 py-1 text-[0.6875rem] text-[var(--text-secondary)] hover:border-[var(--border-default)]">
              <BrandIcon name="trash" size={12} />{T.remove}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
