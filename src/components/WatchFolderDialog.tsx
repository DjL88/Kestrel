import { useEffect, useRef, useState } from 'react';
import { pickWatchFolder, type FolderSource } from '../providers/folderSource';
import { focusBeforeOpening, returnFocus } from './focusReturn';
import { projectsText as t } from '../i18n/areas/projects';

const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-300';

/** Choose a folder to watch for new photos, and whether the photos already in it come in too. */
export function WatchFolderDialog({ onStart, onClose }: { onStart: (source: FolderSource, includeExisting: boolean) => void; onClose: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const previous = useRef<HTMLElement | null>(focusBeforeOpening());
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const keep = previous.current;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', close, true);
    return () => { document.removeEventListener('keydown', close, true); returnFocus(keep); };
  }, [onClose]);

  async function choose(includeExisting: boolean) {
    setNote(null);
    try {
      const picked = await pickWatchFolder();
      if (picked === 'cancelled') return;
      if (picked === 'unsupported') { setNote(t.watch.cannotWatch); return; }
      onStart(picked, includeExisting);
      onClose();
    } catch { setNote(t.common.couldNotOpenFolder); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="watch-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const order = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
        if (!order.length) return;
        const at = order.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
      }}>
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/12 bg-kestrel-panel shadow-2xl">
        <header className="shrink-0 border-b border-white/10 px-5 py-4">
          <h2 id="watch-title" ref={heading} tabIndex={-1} className="text-base font-semibold text-zinc-100 focus:outline-none">{t.watch.title}</h2>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
          <p>{t.watch.body}</p>
          <div className="flex flex-col gap-2">
            <button type="button" className={action} onClick={() => void choose(false)}>{t.watch.newOnly}</button>
            <button type="button" className={action} onClick={() => void choose(true)}>{t.watch.importThenWatch}</button>
          </div>
          {note && <p role="status">{note}</p>}
        </div>
        <footer className="shrink-0 border-t border-white/10 px-5 py-3"><button type="button" onClick={onClose} className={`${action} w-full`}>{t.common.close}</button></footer>
      </div>
    </div>
  );
}
