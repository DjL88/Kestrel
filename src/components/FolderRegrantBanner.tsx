import React from 'react';
import { FolderKey } from 'lucide-react';

interface FolderRegrantBannerProps {
  visible: boolean;
  mode: 'folder' | 'files';
  folderName?: string;
  onReconnect: () => void;
  onDismiss: () => void;
}

export const FolderRegrantBanner: React.FC<FolderRegrantBannerProps> = ({
  visible,
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
          {mode === 'folder'
            ? `Browser security paused read access to "${folderName ?? 'your folder'}" after reload. Your culling decisions are preserved.`
            : 'Some local files were too large for browser storage. Re-select them to restore previews while keeping all decisions.'}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onReconnect}
          className="px-3 py-1 rounded bg-amber-400 hover:bg-amber-300 text-zinc-950 font-semibold transition-colors"
        >
          {mode === 'folder' ? 'Grant Folder Access' : 'Re-open Files'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-2 py-1 rounded text-amber-200 hover:bg-white/10"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};
