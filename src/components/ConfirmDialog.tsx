import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation. Focus starts on the safe choice, Escape cancels and Tab stays inside. */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel, onConfirm, onCancel }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      onKeyDown={(event) => {
        // Keep keys such as K and X from reaching the culling shortcuts underneath.
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
        if (event.key === 'Tab') {
          const order = [cancel.current, confirm.current];
          const at = order.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault();
          order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
        }
      }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body"
        className="w-full max-w-md space-y-3 rounded-xl border border-white/15 bg-kestrel-raised p-5 shadow-2xl">
        <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
        <div id="confirm-body" className="space-y-2 text-sm text-zinc-300">{children}</div>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button ref={cancel} type="button" onClick={onCancel}
            className="min-h-11 rounded-md border border-white/20 px-4 text-sm font-semibold hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300">{cancelLabel}</button>
          <button ref={confirm} type="button" onClick={onConfirm}
            className="min-h-11 rounded-md bg-kestrel-copper px-4 text-sm font-semibold text-zinc-950 hover:bg-kestrel-copper-hover focus-visible:outline-2 focus-visible:outline-sky-300">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
