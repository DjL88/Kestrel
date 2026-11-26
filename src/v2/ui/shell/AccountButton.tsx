import BrandIcon from '../icons/BrandIcon';
import { STRINGS } from '../strings';

/**
 * Top right of the home page and the editor: who is signed in, at a glance. Signed in, a round badge with the first
 * letter of the person's name (and the name itself on wider screens); signed out, a "Sign in" button. Either opens
 * Settings → Account. Never a colour-only cue: the label always says which state it is.
 */
export function AccountButton({ name, onOpen }: { name: string | null; onOpen: () => void }) {
  const t = STRINGS.hubMore;
  const label = name ? t.accountSignedIn(name) : t.accountSignIn;
  const initial = name ? Array.from(name.trim())[0]?.toLocaleUpperCase('en-GB') ?? '?' : '';
  return (
    <button type="button" data-testid="account-button" data-signed-in={name ? 'true' : 'false'} onClick={onOpen}
      aria-label={label} title={label}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
      {name ? (
        <>
          <span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface-raised)] text-[12px] font-semibold text-[var(--text-primary)]">{initial}</span>
          <span className="hidden max-w-[10rem] truncate lg:inline">{name}</span>
        </>
      ) : (
        <>
          <BrandIcon name="account" size={17} />
          <span className="hidden sm:inline">{t.accountSignIn}</span>
        </>
      )}
    </button>
  );
}
