import { Cloud, Folder, HardDrive, Server } from 'lucide-react';
import type { ProviderKind } from '../core/connections';

/**
 * A simple mark for each kind of place, like the platform marks in the export screen. They are plain shapes, not the
 * companies' logos: the name is always written beside them, and official logos can be added when each service is connected.
 */
const ICONS: Record<ProviderKind, typeof Cloud> = { folder: Folder, webdav: Server, s3: Cloud, dropbox: HardDrive, googledrive: HardDrive, onedrive: Cloud };

export function ProviderIcon({ kind, className = 'h-4 w-4' }: { kind: ProviderKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={className} aria-hidden="true" />;
}
