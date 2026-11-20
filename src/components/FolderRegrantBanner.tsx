import React from 'react';
import { FolderKey } from 'lucide-react';
import { projectsText as t } from '../i18n/areas/projects';

interface FolderRegrantBannerProps {
  visible: boolean;
  status?: string;
  mode: 'folder' | 'files';
  folderName?: string;
  onReconnect: () => void;
  onDismiss: () => void;
}

export const FolderRegrantBanner: React.FC<FolderRegrantBannerProps> = ({
  visible,
  status,
  mode,
  folderName,
  onReconnect,
  onDismiss,
}) => {
  if (!visible) return null;

  return (
    <div
      role="status"
      className="shrink-0 bg-amber-500/12 border-b border-amber-400/30 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-100"
    >
      <div className="flex items-center gap-2">
        <FolderKey className="w-4 h-4 text-amber-300 shrink-0" aria-hidden="true" />
        <span>
          {status ?? (mode === 'folder'
            ? t.regrant.paused(folderName ?? t.regrant.yourFolder)
            : t.regrant.reselect)}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onReconnect}
          className="min-h-11 px-3 py-1 rounded bg-amber-400 hover:bg-amber-300 text-zinc-950 font-semibold transition-colors"
        >
          {mode === 'folder' ? t.regrant.grant : t.regrant.reopen}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-11 px-2 py-1 rounded text-amber-200 hover:bg-white/10"
        >
          {t.regrant.dismiss}
        </button>
      </div>
    </div>
  );
};
