import React from 'react';
import type { MaskLayer, Photo, WorkspaceStore } from '../contract';
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
}: MasksPanelProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">Select a photo to manage masks.</p>;
  }

  const autoTools: Array<{ id: MaskLayer['type']; label: string; icon: BrandIconName }> = [
    { id: 'subject', label: STRINGS.masks.subject, icon: 'find-subject' },
    { id: 'sky', label: STRINGS.masks.sky, icon: 'mountain' },
    { id: 'background', label: STRINGS.masks.background, icon: 'masks' },
  ];

  const manualTools: Array<{ id: WorkspaceStore['activeMaskTool']; label: string; icon: BrandIconName }> = [
    { id: 'brush', label: STRINGS.masks.brush, icon: 'brush' },
    { id: 'eraser', label: STRINGS.masks.eraser, icon: 'eraser' },
    { id: 'area', label: STRINGS.masks.selectArea, icon: 'select-area' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
        {STRINGS.masks.subtitle}
      </p>

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
              onClick={() => {
                onSetMaskTool(tool.id);
                onAddMaskLayer(photo.id, tool.id);
              }}
              className={`flex h-9 items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-3 text-xs font-medium transition-colors ${
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
        <div className="grid grid-cols-3 gap-1.5">
          {manualTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => onSetMaskTool(tool.id)}
              className={`flex flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] border py-2.5 text-[11px] font-medium transition-colors ${
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
          {photo.masks.length === 0 && <p className="text-[11px] text-[var(--text-muted)]">No masks yet. Detect the subject or select the background to start.</p>}
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
                    <span className="ml-2 text-[10px] text-[var(--text-muted)]">{Object.keys(layer.edit).length ? `${Object.keys(layer.edit).length} adjusted` : 'no adjustments'}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${layer.name}`}
                    onClick={() => onRemoveMaskLayer(photo.id, layer.id)}
                    className="text-[var(--text-muted)] hover:text-[var(--semantic-danger)]"
                  >
                    <BrandIcon name="trash" size={13} />
                  </button>
                </div>
                {expanded && (
                  <div className="space-y-2 border-t border-[var(--border-subtle)] px-2.5 py-2.5">
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
        Subject and Background are found on this device. Sky, brush and area masks are not available yet.
      </p>
    </div>
  );
}
