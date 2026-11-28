import React, { useRef } from 'react';
import type { ThemeMode } from '../contract';
import { STRINGS } from '../strings';
import { useDialogFocus } from '../utils/dialogFocus';
import BrandIcon from '../icons/BrandIcon';
import { POLICY_PATHS, SiteLink } from '../../../components/SiteLink';

/**
 * The Projects page's side menu on a phone: Settings, Back up (restore), Privacy, Terms and the light or dark switch live
 * behind one ⋯ button, so the page keeps its height for projects and the bar and footer are not two more rows of chrome.
 * It slides in from the right over a dimmed page, keeps clear of the notch and home indicator, and closes with the
 * button, a tap outside, the swipe-back gesture's Escape or Escape.
 */
export default function HubMenu({ onClose, theme, onToggleTheme, onOpenSettings, onRestoreBackup }: {
  onClose: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  /** Left out where backups cannot be restored (the button is then not shown). */
  onRestoreBackup?: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const onKeyDown = useDialogFocus(true, panel, onClose);
  const row = 'flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]';
  return (
    <div data-testid="hub-menu" role="dialog" aria-modal="true" aria-label={STRINGS.mobile.more} onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex justify-end bg-[var(--bg-scrim)]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} tabIndex={-1}
        className="flex h-full w-[min(20rem,85vw)] flex-col gap-1 border-l border-[var(--border-default)] bg-[var(--bg-surface)] px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] shadow-[var(--shadow-panel)] outline-none">
        <div className="flex items-center justify-between px-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{STRINGS.mobile.more}</h2>
          <button type="button" aria-label={STRINGS.mobile.closeDrawer} onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]">
            <BrandIcon name="close" size={18} />
          </button>
        </div>
        <button type="button" className={row} onClick={() => { onClose(); onOpenSettings(); }}>
          <BrandIcon name="settings" size={18} />{STRINGS.settings.heading}
        </button>
        {onRestoreBackup && (
          <button type="button" className={row} onClick={() => { onClose(); onRestoreBackup(); }}>
            <BrandIcon name="restore" size={18} />{STRINGS.backup.restore}
          </button>
        )}
        <button type="button" className={row} onClick={onToggleTheme}>
          <BrandIcon name={theme === 'dark' ? 'theme-light' : 'theme-dark'} size={18} />
          {theme === 'dark' ? STRINGS.hubMore.lightMode : STRINGS.hubMore.darkMode}
        </button>
        <div className="mt-2 border-t border-[var(--border-subtle)] pt-2 text-sm text-[var(--text-secondary)]">
          <SiteLink path={POLICY_PATHS.privacy} className="flex min-h-12 items-center rounded-[var(--radius-md)] px-3 hover:bg-[var(--bg-surface-hover)]">{STRINGS.hub.privacyLink}</SiteLink>
          <SiteLink path={POLICY_PATHS.terms} className="flex min-h-12 items-center rounded-[var(--radius-md)] px-3 hover:bg-[var(--bg-surface-hover)]">{STRINGS.hub.termsLink}</SiteLink>
        </div>
      </div>
    </div>
  );
}
