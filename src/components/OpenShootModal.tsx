import React, { useEffect, useRef } from 'react';
import { FolderOpen, ImagePlus, Sparkles, X } from 'lucide-react';
import { supportsDirectoryPicker } from '../providers/localShootLoader';

interface OpenShootModalProps {
  open: boolean;
  onClose: () => void;
  onLoadDemoShoot: () => void;
  onSelectLocalFiles: (files: File[]) => void;
  onOpenLocalFolder: () => void;
  folderError: string | null;
}

export const OpenShootModal: React.FC<OpenShootModalProps> = ({
  open,
  onClose,
  onLoadDemoShoot,
  onSelectLocalFiles,
  onOpenLocalFolder,
  folderError,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canPickFolder = supportsDirectoryPicker();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-shoot-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-xl bg-[#14161A] border border-white/12 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div>
            <h2 id="open-shoot-title" className="text-base font-semibold text-zinc-100">
              Open Shoot
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Originals are read-only. Culling decisions persist locally in your browser.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Open Shoot modal"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/8"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {/* Option 1: Local Image Files */}
          <div className="p-4 rounded-lg bg-[#1A1D23] border border-white/10 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100">
                Choose Local Image Files
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Import local JPEGs (with real EXIF camera, lens &amp; timestamp burst grouping).
                Dropping .NEF files extracts embedded previews only.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.nef,image/jpeg,image/png,image/webp"
              className="hidden"
              data-testid="local-file-input"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length > 0) {
                  onSelectLocalFiles(list);
                }
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 text-xs font-semibold bg-zinc-100 hover:bg-white text-zinc-950 rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Select Files</span>
            </button>
          </div>

          {/* Option 2: Local Folder (File System Access API) */}
          <div className="p-4 rounded-lg bg-[#1A1D23] border border-white/10 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100">
                Open Local Folder (Browser Handle)
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                {canPickFolder
                  ? 'Scan a folder directly without copying files. Requires one-click re-grant after browser restarts.'
                  : 'Folder picker is unavailable in this browser/iframe context. Use Select Files above.'}
              </p>
              {folderError && (
                <p className="text-xs text-orange-300 mt-1.5">{folderError}</p>
              )}
            </div>
            <button
              type="button"
              disabled={!canPickFolder}
              onClick={onOpenLocalFolder}
              className="px-3.5 py-2 text-xs font-semibold bg-[#252932] hover:bg-[#2F3440] disabled:opacity-40 disabled:pointer-events-none text-zinc-100 border border-white/12 rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Pick Folder</span>
            </button>
          </div>

          {/* Option 3: Labelled Demo Shoot */}
          <div className="p-4 rounded-lg bg-[#1A1D23] border border-white/10 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100">
                500-Frame Demo Shoot (Simulated Nikon Z8 / Z5II)
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Wildlife, bird, and Coco bursts across 500 frames for testing Compare mode,
                virtualized scrolling, and macro pad shortcuts.
              </p>
            </div>
            <button
              type="button"
              onClick={onLoadDemoShoot}
              className="px-3.5 py-2 text-xs font-semibold bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-400/40 rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Load Demo</span>
            </button>
          </div>

          {/* Persistence Comparison Note */}
          <div className="pt-2 border-t border-white/8 text-[11px] text-zinc-400 space-y-1">
            <div className="font-semibold text-zinc-300">
              What persists in Browser vs Native Desktop (Tauri)
            </div>
            <p>
              <span className="text-zinc-200 font-medium">Browser prototype:</span> Persists
              decisions, selection, filter, keeper target, keymap, and small JPEG blobs in
              IndexedDB. Folder handles require a one-click permission re-grant after reload.
            </p>
            <p>
              <span className="text-zinc-200 font-medium">Native desktop target:</span> Persists
              all shoots in local SQLite keyed by stable volume/relative-path IDs, extracts full
              NEF previews natively, and keeps NAS relinking automatic.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
