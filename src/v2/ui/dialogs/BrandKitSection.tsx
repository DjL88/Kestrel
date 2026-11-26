import React, { useState } from 'react';

/** A saved brand kit as the export dialog sees it. */
export interface BrandKitChoice { id: string; name: string; logoLabel: string }

export interface BrandKitSectionProps {
  kits: BrandKitChoice[];
  chosenId: string;
  onChoose: (id: string) => void;
  /** The photo the dialog opened on: its logo, colours and text style are what Save and Update take. */
  photoId: string;
  onSave: (photoId: string, name: string) => boolean;
  onEdit: (kitId: string, change: { name?: string; fromPhotoId?: string }) => boolean;
  onDelete: (kitId: string) => void;
}

const field = 'min-h-10 min-w-0 flex-1 rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]';
const button = 'min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]';

/** Brand kits (K080): choose one and Export puts its logo, colours and text style on every photo in one step. */
export default function BrandKitSection({ kits, chosenId, onChoose, photoId, onSave, onEdit, onDelete }: BrandKitSectionProps) {
  const chosen = kits.find((kit) => kit.id === chosenId);
  const [name, setName] = useState('');
  const choose = (id: string) => { onChoose(id); setName(kits.find((kit) => kit.id === id)?.name ?? ''); };
  return (
    <section className="space-y-2" aria-labelledby="export-brand-kit-title" data-testid="export-brand-kits">
      <h3 id="export-brand-kit-title" className="text-xs font-semibold text-[var(--text-primary)]">Brand kit</h3>
      {kits.length > 0 && (
        <select aria-label="Brand kit to put on" value={chosen ? chosen.id : ''} onChange={(event) => choose(event.target.value)}
          className="min-h-10 w-full rounded bg-[var(--bg-input)] p-2 text-xs text-[var(--text-primary)]">
          <option value="">No brand kit</option>
          {kits.map((kit) => <option key={kit.id} value={kit.id}>{kit.name}</option>)}
        </select>
      )}
      {chosen && (
        <p className="text-[0.6875rem] text-[var(--text-secondary)]" data-testid="brand-kit-summary">
          Logo: {chosen.logoLabel}. Export puts this kit's logo, colours and text style on each photo, as an Undo step in its History. Your words stay, and originals are never changed.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={name} maxLength={40} aria-label="Brand kit name" placeholder="Brand kit name"
          onChange={(event) => setName(event.target.value)} className={field} />
        {chosen ? (
          <button type="button" className={button} onClick={() => onEdit(chosen.id, { name })}>Rename</button>
        ) : (
          <button type="button" className={button} onClick={() => { if (onSave(photoId, name)) setName(''); }}>Save this photo's look as a kit</button>
        )}
      </div>
      {chosen && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={button} onClick={() => onEdit(chosen.id, { fromPhotoId: photoId })}>Use this photo's look</button>
          <button type="button" className={button} onClick={() => { onDelete(chosen.id); choose(''); }}>Delete {chosen.name}</button>
        </div>
      )}
    </section>
  );
}
