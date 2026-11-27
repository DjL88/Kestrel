import React from 'react';
import type { LookPreset, Photo } from '../contract';
import { looksText as T } from '../../../i18n/areas/looks';

export interface UserLookActions {
  onSave: (photoId: string, name: string) => boolean;
  onRename: (lookId: string, name: string) => boolean;
  onDelete: (lookId: string) => void;
  onExport: () => string | null;
  onImport: (text: string) => void;
}

interface UserLooksSectionProps extends UserLookActions {
  photo: Photo;
  looks: LookPreset[];
  appliedLookId: string;
  onApplyLook: (photoId: string, lookId: string) => void;
  onHoverLook: (lookId: string | null) => void;
}

const smallButton = 'min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-[0.6875rem] font-medium text-[var(--text-secondary)] hover:border-[var(--border-default)] disabled:opacity-50';
const input = 'min-h-9 w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]';

/** Your own looks: save the current sliders under a name, apply, rename, delete, and share them as a small file. */
export default function UserLooksSection({ photo, looks, appliedLookId, onApplyLook, onHoverLook, onSave, onRename, onDelete, onExport, onImport }: UserLooksSectionProps) {
  const [name, setName] = React.useState('');
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (onSave(photo.id, name)) setName('');
  };
  const download = () => {
    const text = onExport();
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inflight-looks.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="user-looks-heading" className="space-y-2 border-t border-[var(--border-subtle)] pt-3" data-testid="user-looks">
      <h3 id="user-looks-heading" className="text-xs font-semibold text-[var(--text-primary)]">{T.heading}</h3>
      <p className="text-[0.6875rem] text-[var(--text-muted)]">{T.intro}</p>
      <form className="flex items-center gap-1.5" onSubmit={save}>
        <label htmlFor="user-look-name" className="sr-only">{T.nameLabel}</label>
        <input id="user-look-name" className={input} value={name} maxLength={40} placeholder={T.namePlaceholder} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className={smallButton} disabled={!name.trim()}>{T.save}</button>
      </form>
      {looks.length === 0 ? <p className="text-[0.6875rem] text-[var(--text-muted)]">{T.empty}</p> : (
        <ul className="grid grid-cols-2 gap-2" onMouseLeave={() => onHoverLook(null)}>
          {looks.map((look) => {
            const active = appliedLookId === look.id;
            const editing = renaming?.id === look.id;
            return (
              <li key={look.id} className={`flex flex-col overflow-hidden rounded-[var(--radius-sm)] border ${active ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]' : 'border-[var(--border-subtle)] bg-[var(--bg-input)]'}`}>
                <button type="button" aria-pressed={active} title={look.description}
                  onMouseEnter={() => onHoverLook(look.id)} onFocus={() => onHoverLook(look.id)} onBlur={() => onHoverLook(null)}
                  onClick={() => { onApplyLook(photo.id, look.id); onHoverLook(null); }} className="flex flex-col text-left">
                  <span className="aspect-[16/10] w-full overflow-hidden bg-[var(--bg-canvas)]">
                    <img src={photo.thumbUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" style={{ filter: look.previewFilter }} />
                  </span>
                  <span className={`truncate px-2 pt-1.5 text-[0.6875rem] font-medium ${active ? 'text-[var(--brand-accent)]' : 'text-[var(--text-secondary)]'}`}>
                    {look.name}{active ? ' · Applied' : ''}
                  </span>
                </button>
                {editing ? (
                  <form className="flex flex-col gap-1 p-1.5" onSubmit={(e) => { e.preventDefault(); if (onRename(look.id, renaming.name)) setRenaming(null); }}>
                    <label htmlFor={`rename-${look.id}`} className="sr-only">{T.renameLabel(look.name)}</label>
                    <input id={`rename-${look.id}`} autoFocus className={input} value={renaming.name} maxLength={40}
                      onChange={(e) => setRenaming({ id: look.id, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }} />
                    <span className="flex gap-1">
                      <button type="submit" className={smallButton}>{T.renameDone}</button>
                      <button type="button" className={smallButton} onClick={() => setRenaming(null)}>{T.cancel}</button>
                    </span>
                  </form>
                ) : (
                  <span className="flex gap-1 p-1.5">
                    <button type="button" className={smallButton} aria-label={T.rename(look.name)} onClick={() => setRenaming({ id: look.id, name: look.name })}>{T.renameShort}</button>
                    <button type="button" className={smallButton} aria-label={T.remove(look.name)} onClick={() => onDelete(look.id)}>{T.removeShort}</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={smallButton} onClick={download} disabled={looks.length === 0}>{T.exportLooks}</button>
        <button type="button" className={smallButton} onClick={() => fileRef.current?.click()}>{T.importLooks}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" data-testid="user-looks-file"
          onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onImport(await file.text()); }} />
      </div>
    </section>
  );
}
