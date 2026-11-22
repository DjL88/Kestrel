import React, { useState } from 'react';
import BrandIcon from '../icons/BrandIcon';

interface InfoPopoverProps {
  title: string;
  body: string;
}

export default function InfoPopover({ title, body }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`About ${title}`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
      >
        <BrandIcon name="info" size={13} />
      </button>

      {open && (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-3 text-left shadow-[var(--shadow-popover)]"
        >
          <p className="text-xs font-semibold text-[var(--text-primary)]">{title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {body}
          </p>
        </div>
      )}
    </span>
  );
}
