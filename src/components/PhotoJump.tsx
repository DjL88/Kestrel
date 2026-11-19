import { useEffect, useId, useRef, useState } from 'react';
import { photoIndexFromNumber, photoPositionLabel } from '../core/photoJump';

interface PhotoJumpProps {
  index: number;
  total: number;
  onJump: (index: number) => void;
}

/**
 * Section F shared footer: an accessible '1 of 28' Jump control for culling
 * and editing. The inline field never opens a free-floating pane over the photo.
 * Enter jumps; Escape cancels; other keyboard shortcuts are left alone.
 */
export function PhotoJump({ index, total, onJump }: PhotoJumpProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const position = photoPositionLabel(index, total);
  const enabled = total > 0 && index >= 0 && index < total;
  useEffect(() => {
    if (!open) return;
    setInput(String(index + 1));
    setInvalid(false);
    field.current?.focus();
    field.current?.select();
  }, [open, index]);
  const close = () => { setOpen(false); setInvalid(false); };
  const submit = () => {
    const target = photoIndexFromNumber(input, total);
    if (target === null) {
      setInvalid(true);
      field.current?.focus();
      return;
    }
    close();
    if (target !== index) onJump(target);
  };
  return (
    <div role="group" aria-label="Photo position and jump" className="inline-flex h-11 shrink-0 items-center gap-1">
      {!open ? (
        <button type="button" disabled={!enabled} onClick={() => setOpen(true)}
          aria-label={`Jump to photo. Currently ${position}`}
          title="Jump to photo number"
          className="inline-flex h-11 min-w-24 items-center justify-center gap-2 rounded-md px-2 text-xs font-medium tabular-nums text-zinc-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-40">
          <span>{position}</span>
          <span className="text-kestrel-copper">Jump</span>
        </button>
      ) : (
        <form className="inline-flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label htmlFor={labelId} className="sr-only">Photo number from 1 to {total}</label>
          <input ref={field} id={labelId} type="text" inputMode="numeric" autoComplete="off"
            value={input} maxLength={String(total).length} aria-invalid={invalid}
            aria-describedby={invalid ? `${labelId}-error` : undefined}
            onChange={(event) => { setInput(event.target.value); setInvalid(false); }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            }}
            className="h-11 w-14 rounded-md border border-white/30 bg-kestrel-raised px-1 text-center text-sm tabular-nums text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300" />
          <span className="whitespace-nowrap text-xs text-zinc-400">of {total}</span>
          <button type="submit" className="h-11 min-w-11 rounded-md px-2 text-sm font-medium text-zinc-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
            Go
          </button>
          <button type="button" onClick={close} className="h-11 min-w-11 rounded-md px-2 text-sm text-zinc-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
            Cancel
          </button>
          {invalid && <span id={`${labelId}-error`} role="alert" className="whitespace-nowrap text-xs text-orange-200">Enter 1–{total}</span>}
        </form>
      )}
    </div>
  );
}
