import { PHOTO_ACCEPT } from '../core/rawFormats';
import React, { useEffect, useRef, useState } from 'react';
import { focusBeforeOpening, returnFocus } from './focusReturn';
import { FolderOpen, ImagePlus, X } from './icons/KestrelUIIcons';
import { isSupportedPhotoFilename, supportsDirectoryPicker } from '../providers/localShootLoader';
import { isDesktopApp } from '../providers/desktopShell';
import { projectsText as t } from '../i18n/areas/projects';
import { pickFolderNatively, pickPhotosNatively, type PickedPhoto } from '../providers/linkedOriginals';

interface OpenShootModalProps {
  open: boolean;
  onClose: () => void;
  onSelectLocalFiles: (files: Array<File | PickedPhoto>) => void;
  onOpenLocalFolder: () => void;
  folderError: string | null;
}

export const OpenShootModal: React.FC<OpenShootModalProps> = ({
  open,
  onClose,
  onSelectLocalFiles,
  onOpenLocalFolder,
  folderError,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dropError, setDropError] = useState(false);
  const [nativeError, setNativeError] = useState('');
  function selectFiles(files: File[]) {
    const photos = files.filter((file) => isSupportedPhotoFilename(file.name));
    setDropError(!photos.length);
    if (photos.length) onSelectLocalFiles(photos);
  }

  // In the desktop app, photos are chosen with the system's own dialog and stay where they are on the disk.
  async function chooseNatively(pick: typeof pickPhotosNatively) {
    setNativeError('');
    try {
      const chosen = await pick();
      if (chosen === 'cancelled') return;
      setDropError(!chosen.length);
      if (chosen.length) onSelectLocalFiles(chosen);
    } catch (error) { setNativeError(error instanceof Error ? error.message : String(error)); }
  }

  // The desktop app is not a web page, so it does not use the browser's folder picker, which asks permission for "this website".
  const canPickFolder = supportsDirectoryPicker() && !isDesktopApp();

  useEffect(() => {
    if (!open) {
      setDropError(false);
      return;
    }
    const previous = focusBeforeOpening();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); returnFocus(previous); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-shoot-title"
      data-handles-drop
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        event.preventDefault();
        selectFiles(Array.from(event.dataTransfer.files));
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const order = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
        if (!order.length) return;
        const at = order.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-xl bg-kestrel-panel border border-white/12 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div>
            <h2 id="open-shoot-title" className="text-base font-semibold text-zinc-100">
              {t.addPhotos.title}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {t.addPhotos.intro(isDesktopApp())}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.addPhotos.close} title={t.addPhotos.close}
            className="grid min-h-11 min-w-11 place-items-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/8"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {/* Option 1: Local Image Files */}
          <div className="p-4 rounded-lg bg-[#1A1D23] border border-white/10 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100">
                {t.addPhotos.imageFiles}
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                {t.addPhotos.imageFilesHint}
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={PHOTO_ACCEPT}
              className="hidden"
              data-testid="local-file-input"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length > 0) selectFiles(list);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => (isDesktopApp() ? void chooseNatively(pickPhotosNatively) : fileInputRef.current?.click())}
              className="min-h-11 px-3.5 py-2 text-sm font-semibold bg-zinc-100 hover:bg-white text-zinc-950 rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t.addPhotos.chooseFiles}</span>
            </button>
          </div>

          {nativeError && <p role="alert" className="text-sm text-orange-200">{t.addPhotos.couldNotRead(nativeError)}</p>}
          {folderError && <p role="alert" className="text-sm text-orange-200">{folderError}</p>}
          {dropError && <p role="alert" className="text-sm text-orange-200">{t.addPhotos.unsupported}</p>}

          {/* Option 2: Local Folder (File System Access API) */}
          <div className="p-4 rounded-lg bg-[#1A1D23] border border-white/10 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100">
                {t.addPhotos.folderTitle}
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                {canPickFolder || isDesktopApp()
                  ? t.addPhotos.folderHint
                  : t.addPhotos.folderUnavailable}
              </p>
            </div>
            <button
              type="button"
              disabled={!canPickFolder && !isDesktopApp()}
              onClick={() => (isDesktopApp() ? void chooseNatively(pickFolderNatively) : onOpenLocalFolder())}
              className="min-h-11 px-3.5 py-2 text-sm font-semibold bg-[#252932] hover:bg-[#2F3440] disabled:opacity-40 disabled:pointer-events-none text-zinc-100 border border-white/12 rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t.addPhotos.chooseFolder}</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
