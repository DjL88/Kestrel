import { Cloud, Folder, Server } from './icons/KestrelUIIcons';
import type { ProviderKind } from '../core/connections';

/**
 * A mark for each kind of place. Dropbox, Google Drive and OneDrive get simple brand-coloured marks drawn here so the
 * person recognises them at a glance; the name is always written beside them, so no meaning rests on colour alone.
 * Before public release, swap these for each company's official asset, following its brand guidelines.
 */
const PLAIN: Partial<Record<ProviderKind, typeof Cloud>> = { folder: Folder, webdav: Server, s3: Cloud };

function BrandMark({ kind, className }: { kind: 'dropbox' | 'googledrive' | 'onedrive'; className: string }) {
  if (kind === 'dropbox') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
        <g fill="#0061FF"><path d="M6.2 2.5 12 6.2 6.2 9.9 .5 6.2z" /><path d="M17.8 2.5l5.7 3.7-5.7 3.7L12 6.2z" /><path d="M.5 13.6l5.7-3.7L12 13.6l-5.7 3.7z" /><path d="M12 13.6l5.8-3.7 5.7 3.7-5.7 3.7z" /><path d="M6.3 18.4 12 14.7l5.7 3.7L12 22.1z" /></g>
      </svg>
    );
  }
  if (kind === 'googledrive') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
        <path d="M8.3 2h7.4l7 12.2h-7.4z" fill="#FFBA00" /><path d="M8.3 2 1.3 14.2l3.7 6.4L12 8.4z" fill="#0F9D58" /><path d="M5 20.6h14.1l3.6-6.4H8.7z" fill="#4285F4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path d="M9.6 7.5a5 5 0 0 1 9 2.1 3.9 3.9 0 0 1 .5 7.8H6.2a4.4 4.4 0 0 1-.9-8.7 5 5 0 0 1 4.3-1.2z" fill="#0A64C9" /><path d="M9.6 7.5a5 5 0 0 0-4.3 1.2 4.4 4.4 0 0 0 .9 8.7h6.4z" fill="#28A8EA" />
    </svg>
  );
}

export function ProviderIcon({ kind, className = 'h-4 w-4' }: { kind: ProviderKind; className?: string }) {
  if (kind === 'dropbox' || kind === 'googledrive' || kind === 'onedrive') return <BrandMark kind={kind} className={className} />;
  const Icon = PLAIN[kind] ?? Cloud;
  return <Icon className={className} aria-hidden="true" />;
}
