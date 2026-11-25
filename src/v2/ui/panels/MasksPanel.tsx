import React from 'react';
import type { MaskGeometryField, MaskLayer, Photo, WorkspaceStore } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { type BrandIconName } from '../icons/BrandIcon';
import { MASK_SLIDERS } from '../../engineClient/maskOps';

interface MasksPanelProps {
  photo: Photo | null;
  activeMaskTool: WorkspaceStore['activeMaskTool'];
  onSetMaskTool: (tool: WorkspaceStore['activeMaskTool']) => void;
  onAddMaskLayer: (photoId: string, type: MaskLayer['type']) => void;
  onToggleMaskLayer: (photoId: string, maskId: string) => void;
  onRemoveMaskLayer: (photoId: string, maskId: string) => void;
  onSetMaskEdit: (photoId: string, maskId: string, key: string, value: number) => void;
  onSetMaskFeather: (photoId: string, maskId: string, percent: number) => void;
  onSetMaskGeometry: (photoId: string, maskId: string, field: MaskGeometryField, value: number) => void;
  onSetMaskLimit: (photoId: string, maskId: string, limit: MaskLayer['limit'] | null) => void;
  onPreviewMask?: (selection: { photoId: string; maskId: string } | null) => void;
}

export default function MasksPanel({
  photo,
  activeMaskTool,
  onSetMaskTool,
  onAddMaskLayer,
  onToggleMaskLayer,
  onRemoveMaskLayer,
  onSetMaskEdit,
  onSetMaskFeather,
  onSetMaskGeometry,
  onSetMaskLimit,
  onPreviewMask,
}: MasksPanelProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const seen = React.useRef<{ photoId: string; ids: string[] } | null>(null);
  React.useEffect(() => {
    if (!photo) { seen.current = null; return; }
    const ids = photo.masks.map(layer => layer.id);
    if (seen.current?.photoId === photo.id) {
      const newlyAdded = ids.find(id => !seen.current!.ids.includes(id));
      if (newlyAdded) setOpenId(newlyAdded);
    } else {
      setOpenId(null);
    }
    seen.current = { photoId: photo.id, ids };
  }, [photo?.id, photo?.masks]);
  const previewId = photo?.masks.find(layer => layer.id === openId && layer.visible)?.id;
  React.useEffect(() => {
    onPreviewMask?.(photo && previewId ? { photoId: photo.id, maskId: previewId } : null);
    return () => onPreviewMask?.(null);
  }, [photo?.id, previewId, onPreviewMask]);
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">{STRINGS.panelWords.selectToMask}</p>;
  }

  const autoTools: Array<{ id: MaskLayer['type']; label: string; icon: BrandIconName }> = [
    { id: 'subject', label: STRINGS.masks.subject, icon: 'find-subject' },
    { id: 'sky', label: STRINGS.masks.sky, icon: 'mountain' },
    { id: 'background', label: STRINGS.masks.background, icon: 'masks' },
  ];

  const manualTools: Array<{ id: WorkspaceStore['activeMaskTool']; label: string; icon: BrandIconName }> = [
    { id: 'brush', label: STRINGS.masks.brush, icon: 'brush' },
    { id: 'eraser', label: STRINGS.masks.eraser, icon: 'eraser' },
    { id: 'area', label: STRINGS.panelWords.ovalArea, icon: 'select-area' },
    { id: 'gradient', label: STRINGS.panelWords.gradient, icon: 'mountain' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
        {STRINGS.masks.subtitle}
      </p>

      <p role="status" className="text-[11px] leading-relaxed text-[var(--text-muted)]">{STRINGS.panelWords.maskStatus}</p>

      {/* Auto-detect mask triggers */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          {STRINGS.masks.autoDetectHeading}
        </h3>
        <div className="grid grid-cols-1 gap-1.5">
          {autoTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              disabled={tool.id === 'sky'}
              title={tool.id === 'sky' ? STRINGS.panelWords.skyUnavailable : undefined}
              onClick={() => {
                onSetMaskTool(tool.id);
                onAddMaskLayer(photo.id, tool.id);
              }}
              className={`disabled:cursor-not-allowed disabled:opacity-50 flex h-9 items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-3 text-xs font-medium transition-colors ${
                activeMaskTool === tool.id
                  ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)] hover:border-[var(--border-default)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <BrandIcon name={tool.icon} size={15} />
                <span>{tool.label}</span>
              </span>
              <BrandIcon name="plus" size={13} />
            </button>
          ))}
        </div>
      </div>

      {/* Manual refinement tools */}
      <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3.5">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          {STRINGS.masks.manualToolsHeading}
        </h3>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {manualTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              disabled={tool.id === 'brush' || tool.id === 'eraser'}
              title={tool.id === 'brush' || tool.id === 'eraser'
                ? STRINGS.panelWords.paintingUnavailable
                : STRINGS.panelWords.addShapeMask}
              onClick={() => {
                onSetMaskTool(tool.id);
                if (tool.id === 'area' || tool.id === 'gradient') onAddMaskLayer(photo.id, tool.id);
              }}
              className={`disabled:cursor-not-allowed disabled:opacity-50 flex flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] border py-2.5 text-[11px] font-medium transition-colors ${
                activeMaskTool === tool.id
                  ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BrandIcon name={tool.icon} size={16} />
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Active Mask Layers */}
      <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3.5">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          Active layers ({photo.masks.length})
        </h3>
        <div className="space-y-1.5">
          {photo.masks.length === 0 && <p className="text-[11px] text-[var(--text-muted)]">{STRINGS.panelWords.noMasks}</p>}
          {photo.masks.map((layer) => {
            const expanded = openId === layer.id;
            return (
              <div key={layer.id} className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)]">
                <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                  <button
                    type="button"
                    aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
                    aria-pressed={layer.visible}
                    onClick={() => onToggleMaskLayer(photo.id, layer.id)}
                    className="text-[var(--text-muted)]"
                  >
                    <BrandIcon name={layer.visible ? 'eye' : 'eye-off'} size={14} className={layer.visible ? 'text-[var(--brand-accent)]' : ''} />
                  </button>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpenId(expanded ? null : layer.id)}
                    className="min-w-0 flex-1 truncate text-left text-xs text-[var(--text-primary)]"
                  >
                    <span className={layer.visible ? '' : 'opacity-50'}>{layer.name}</span>
                    {layer.limit && <span className="ml-1 text-[10px] text-[var(--text-muted)]">{layer.limit.mode === 'intersect' ? '· Intersected' : '· Subtracted'}</span>}
                    <span className="ml-2 text-[10px] text-[var(--text-muted)]">{Object.keys(layer.edit).length ? `${Object.keys(layer.edit).length} adjusted` : 'no adjustments'}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={STRINGS.panelWords.deleteMask(layer.name)}
                    onClick={() => onRemoveMaskLayer(photo.id, layer.id)}
                    className="text-[var(--text-muted)] hover:text-[var(--semantic-danger)]"
                  >
                    <BrandIcon name="trash" size={13} />
                  </button>
                </div>
                {expanded && (
                  <div className="space-y-2 border-t border-[var(--border-subtle)] px-2.5 py-2.5">
                    {layer.geometry && (() => {
                      const shape = layer.geometry;
                      const geometryRows: Array<{ key: MaskGeometryField; label: string; value: number; min: number; max: number; step: number }> = shape.kind === 'radial'
                        ? [
                          { key: 'cx', label: STRINGS.panelWords.centreLeftRight, value: shape.cx, min: 0, max: 1, step: 0.01 },
                          { key: 'cy', label: STRINGS.panelWords.centreUpDown, value: shape.cy, min: 0, max: 1, step: 0.01 },
                          { key: 'rx', label: STRINGS.panelWords.halfWidth, value: shape.rx, min: 0.01, max: 1, step: 0.01 },
                          { key: 'ry', label: STRINGS.panelWords.halfHeight, value: shape.ry, min: 0.01, max: 1, step: 0.01 },
                          { key: 'angle', label: STRINGS.panelWords.rotateDegrees, value: shape.angle, min: -180, max: 180, step: 1 },
                        ] : [
                          { key: 'x1', label: STRINGS.panelWords.startLeftRight, value: shape.x1, min: 0, max: 1, step: 0.01 },
                          { key: 'y1', label: STRINGS.panelWords.startUpDown, value: shape.y1, min: 0, max: 1, step: 0.01 },
                          { key: 'x2', label: STRINGS.panelWords.endLeftRight, value: shape.x2, min: 0, max: 1, step: 0.01 },
                          { key: 'y2', label: STRINGS.panelWords.endUpDown, value: shape.y2, min: 0, max: 1, step: 0.01 },
                        ];
                      return <fieldset className="space-y-2 border-b border-[var(--border-subtle)] pb-3">
                        <legend className="text-[11px] font-semibold text-[var(--text-primary)]">
                          {shape.kind === 'radial' ? STRINGS.panelWords.ovalPosition : STRINGS.panelWords.gradientDirection}
                        </legend>
                        <p className="text-[11px] text-[var(--text-secondary)]">{STRINGS.panelWords.geometryNote}</p>
                        {geometryRows.map(row => (
                          <label key={row.key} className="block space-y-1 text-[11px] text-[var(--text-secondary)]">
                            <span className="flex justify-between gap-2">
                              <span>{row.label}</span>
                              <span className="font-mono tabular-nums">{row.key === 'angle' ? `${row.value}°` : `${Math.round(row.value * 100)}%`}</span>
                            </span>
                            <input type="range" className="inflight-slider"
                              data-testid={`v2-mask-geometry-${row.key}`}
                              aria-label={`${layer.name} ${row.label}`}
                              min={row.min} max={row.max} step={row.step} value={row.value}
                              onChange={event => onSetMaskGeometry(photo.id, layer.id, row.key, Number(event.target.value))}
                            />
                          </label>
                        ))}
                      </fieldset>;
                    })()}
                    {photo.masks.some(other => other.id !== layer.id) && (
                      <fieldset className="space-y-2 border-b border-[var(--border-subtle)] pb-3">
                        <legend className="text-[11px] font-semibold text-[var(--text-primary)]">{'Combine with another mask'}</legend>
                        <label className="block space-y-1 text-[11px] text-[var(--text-secondary)]">
                          <span>{'Limit to a shape'}</span>
                          <select aria-label={`${layer.name} combination target`} value={layer.limit?.id ?? ''}
                            className="min-h-9 w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2"
                            onChange={event => onSetMaskLimit(photo.id, layer.id, event.target.value ? { id: event.target.value, mode: layer.limit?.mode ?? 'intersect' } : null)}>
                            <option value="">{'No restriction'}</option>
                            {photo.masks.filter(other => other.id !== layer.id).map((other, index) => <option key={other.id} value={other.id}>{`${other.name} · ${index + 1}`}</option>)}
                          </select>
                        </label>
                        {layer.limit && <label className="block space-y-1 text-[11px] text-[var(--text-secondary)]">
                          <span>{'Combination'}</span>
                          <select aria-label={`${layer.name} combination mode`} value={layer.limit.mode}
                            className="min-h-9 w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2"
                            onChange={event => { if (event.target.value === 'intersect' || event.target.value === 'subtract') onSetMaskLimit(photo.id, layer.id, { id: layer.limit!.id, mode: event.target.value }); }}>
                            <option value="intersect">{'Intersect · only the overlap'}</option>
                            <option value="subtract">{'Subtract · exclude the other shape'}</option>
                          </select>
                        </label>}
                        <p className="text-[10px] text-[var(--text-muted)]">{'Uses the other mask’s own shape, even if its adjustments are switched off. Both masks remain editable.'}</p>
                      </fieldset>
                    )}
                    {MASK_SLIDERS.map((slider) => (
                      <label key={slider.key} className="block space-y-1 text-[11px] text-[var(--text-secondary)]">
                        <span className="flex justify-between"><span>{slider.label}</span><span className="font-mono tabular-nums">{(layer.edit[slider.key] ?? 0).toFixed(2)}</span></span>
                        <input
                          type="range" className="inflight-slider" aria-label={`${layer.name} ${slider.label}`}
                          min={slider.min} max={slider.max} step={slider.step} value={layer.edit[slider.key] ?? 0}
                          onChange={(event) => onSetMaskEdit(photo.id, layer.id, slider.key, Number(event.target.value))}
                        />
                      </label>
                    ))}
                    <label className="block space-y-1 text-[11px] text-[var(--text-secondary)]">
                      <span className="flex justify-between"><span>{STRINGS.masks.feather}</span><span className="font-mono tabular-nums">{layer.feather}</span></span>
                      <input
                        type="range" className="inflight-slider" aria-label={`${layer.name} ${STRINGS.masks.feather}`}
                        min={0} max={100} step={1} value={layer.feather}
                        onChange={(event) => onSetMaskFeather(photo.id, layer.id, Number(event.target.value))}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-2.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Subject/Background detection and adjustable Oval/Gradient masks work on this device. Automatic Sky detection and Brush/Eraser painting remain unavailable.
      </p>
    </div>
  );
}
