import { SOCIAL_ICON_PATHS, type SocialIconId } from '../core/socialIcons';

/** A brand mark in the current text colour. It is decoration: the platform's name is always written beside it. */
export function SocialIcon({ id, className = 'h-4 w-4' }: { id: SocialIconId; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d={SOCIAL_ICON_PATHS[id]} />
    </svg>
  );
}
