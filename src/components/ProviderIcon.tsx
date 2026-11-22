import { Cloud, Folder, Server } from './icons/KestrelUIIcons';
import type { ProviderKind } from '../core/connections';
import { BrandIcon } from './BrandIcon';
import oneDriveLogo from '../assets/brand/providers/onedrive.png';

/**
 * A mark for each kind of place, in the current text colour like the export destinations, so it follows the theme and the
 * contrast settings. Dropbox and Google Drive use their marks from the open icon set; the name is always written beside them.
 * OneDrive is not in that set: it uses Microsoft's own full-colour logo (supplied by the owner, 22 Nov 2026), unaltered and
 * never recoloured, as their guidelines require.
 */
const PLAIN: Partial<Record<ProviderKind, typeof Cloud>> = { folder: Folder, webdav: Server, s3: Cloud };

function BrandMark({ kind, className }: { kind: 'dropbox' | 'googledrive' | 'onedrive'; className: string }) {
  if (kind === 'dropbox' || kind === 'googledrive') return <BrandIcon id={kind} className={className} />;
  return <img src={oneDriveLogo} alt="" aria-hidden="true" className={`${className} object-contain`} draggable={false} />;
}

export function ProviderIcon({ kind, className = 'h-4 w-4' }: { kind: ProviderKind; className?: string }) {
  if (kind === 'dropbox' || kind === 'googledrive' || kind === 'onedrive') return <BrandMark kind={kind} className={className} />;
  const Icon = PLAIN[kind] ?? Cloud;
  return <Icon className={className} aria-hidden="true" />;
}
