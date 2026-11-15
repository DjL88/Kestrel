import { useEffect, useRef, type ReactNode } from 'react';
import { returnFocus } from './focusReturn';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
}

/** Modal confirmation. Focus starts on the safe choice, Escape cancels and Tab stays inside. */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel, onConfirm, onCancel, confirmDisabled }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => returnFocus(previous);
  }, []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 sm:p-4"
      onKeyDown={(event) => {
        // Keep keys such as K and X from reaching the culling shortcuts underneath.
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
        if (event.key === 'Tab') {
          // Keep focus inside the dialog, whatever controls it holds.
          const order = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
          if (!order.length) return;
          const at = order.indexOf(document.activeElement as HTMLElement);
          event.preventDefault();
          order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
        }
      }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col rounded-xl border border-white/15 bg-kestrel-raised shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
        <h2 id="confirm-title" className="shrink-0 px-5 pb-2 pt-5 text-lg font-semibold">{title}</h2>
        <div id="confirm-body" className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-3 text-sm text-zinc-300">{children}</div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button ref={cancel} type="button" onClick={onCancel}
            className="min-h-11 rounded-md border border-white/20 px-4 text-sm font-semibold hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300">{cancelLabel}</button>
          <button ref={confirm} type="button" onClick={onConfirm} disabled={confirmDisabled}
            className="min-h-11 rounded-md bg-kestrel-copper px-4 text-sm font-semibold text-zinc-950 hover:bg-kestrel-copper-hover! focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-40">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
