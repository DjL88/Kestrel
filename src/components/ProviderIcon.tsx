import { Cloud, Folder, Server } from './icons/KestrelUIIcons';
import type { ProviderKind } from '../core/connections';
import { BrandIcon } from './BrandIcon';

/**
 * A mark for each kind of place, in the current text colour like the export destinations, so it follows the theme and the
 * contrast settings. Dropbox and Google Drive use their marks from the open icon set; the name is always written beside them.
 * OneDrive has no mark in that set, so it gets a plain cloud until its official asset is added under Microsoft's guidelines.
 */
const PLAIN: Partial<Record<ProviderKind, typeof Cloud>> = { folder: Folder, webdav: Server, s3: Cloud };

function BrandMark({ kind, className }: { kind: 'dropbox' | 'googledrive' | 'onedrive'; className: string }) {
  if (kind === 'dropbox' || kind === 'googledrive') return <BrandIcon id={kind} className={className} />;
  // OneDrive is not in the open icon set, so this is a plain cloud shape; the name is always written beside it.
  return <Cloud className={className} aria-hidden="true" />;
}

export function ProviderIcon({ kind, className = 'h-4 w-4' }: { kind: ProviderKind; className?: string }) {
  if (kind === 'dropbox' || kind === 'googledrive' || kind === 'onedrive') return <BrandMark kind={kind} className={className} />;
  const Icon = PLAIN[kind] ?? Cloud;
  return <Icon className={className} aria-hidden="true" />;
}
