import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import BrandIcon from '../icons/BrandIcon';
import { tooltipPlacement, type TooltipPlacement } from '../utils/tooltipPlacement';

interface InfoPopoverProps {
  title: string;
  body: string;
}

export default function InfoPopover({ title, body }: InfoPopoverProps) {
  const [place, setPlace] = useState<TooltipPlacement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPlace(tooltipPlacement(rect, { width: window.innerWidth, height: window.innerHeight }));
  };
  const hide = () => setPlace(null);

  // Fixed to the window, so it would stay behind if the panel scrolled or the window resized: close it instead.
  useEffect(() => {
    if (!place) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', onKey);
    };
  }, [place]);

  return (
    <span className="relative inline-flex items-center" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`About ${title}`}
        aria-describedby={place ? tooltipId : undefined}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          if (place) hide(); else show();
        }}
        className="v2-hit inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
      >
        <BrandIcon name="info" size={13} />
      </button>

      {place && createPortal(
        // In the workspace root, fixed to the window, so a panel's clipped edge or the side rail can never cover it.
        <div
          id={tooltipId}
          role="tooltip"
          style={{ left: place.left, top: place.top, bottom: place.bottom, width: place.width }}
          className="pointer-events-none fixed z-[60] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-3 text-left shadow-[var(--shadow-popover)]"
        >
          <p className="text-xs font-semibold text-[var(--text-primary)]">{title}</p>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">
            {body}
          </p>
        </div>,
        document.querySelector('.inflight-v2') ?? document.body,
      )}
    </span>
  );
}
