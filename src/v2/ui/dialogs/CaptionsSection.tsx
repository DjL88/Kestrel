import React from 'react';
import type { CaptionTemplate } from '../../../core/captionTemplate';
import { STRINGS } from '../strings';

/**
 * Captions and credits (IPTC) for the Export dialog: one template, saved on this device, folded away until opened.
 * Off by default; nothing is written into a file until the photographer ticks the box.
 */
export default function CaptionsSection({ template, onChange }: { template: CaptionTemplate; onChange: (next: CaptionTemplate) => void }) {
  const t = STRINGS.exportDialog;
  const set = (key: keyof CaptionTemplate, value: string | boolean) => onChange({ ...template, [key]: value });
  const input = 'min-h-10 w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]';
  const fields: Array<[keyof CaptionTemplate, string]> = [
    ['title', t.captionTitle], ['creator', t.captionCreator], ['copyright', t.captionCopyright], ['credit', t.captionCredit],
    ['city', t.captionCity], ['country', t.captionCountry], ['keywords', t.captionKeywords],
  ];
  return (
    <details className="space-y-2" data-testid="export-captions" open={template.enabled || undefined}>
      <summary className="cursor-pointer text-xs font-semibold text-[var(--text-primary)]">{t.captionsHeading}</summary>
      <label className="flex items-center gap-2 pt-2 text-xs text-[var(--text-primary)]">
        <input type="checkbox" checked={template.enabled} onChange={(event) => set('enabled', event.target.checked)} />
        {t.captionsOn}
      </label>
      <p className="text-[0.6875rem] text-[var(--text-secondary)]" data-testid="export-captions-metadata-only">{t.captionsMetadataOnly}</p>
      <p className="text-[0.6875rem] text-[var(--text-secondary)]">{t.captionsHelp}</p>
      <label className="block text-[0.6875rem] text-[var(--text-secondary)]">
        {t.captionCaption}
        <textarea rows={3} maxLength={4096} value={template.caption} onChange={(event) => set('caption', event.target.value)}
          className={`${input} py-1`} />
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {fields.map(([key, label]) => (
          <label key={key} className="block text-[0.6875rem] text-[var(--text-secondary)]">
            {label}
            <input type="text" value={template[key] as string} onChange={(event) => set(key, event.target.value)} className={input} />
          </label>
        ))}
      </div>
      <label className="block text-[0.6875rem] text-[var(--text-secondary)]">
        {t.captionCodes}
        <textarea rows={3} value={template.codes} spellCheck={false} placeholder="raf = Royal Air Force"
          onChange={(event) => set('codes', event.target.value)} className={`${input} py-1 font-mono`} />
      </label>
    </details>
  );
}
