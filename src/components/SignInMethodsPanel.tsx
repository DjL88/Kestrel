import { useEffect, useState } from 'react';
import { LinkingError, methodsToAdd, type LinkingProblem, type SignInMethod } from '../core/accountLinking';
import { addSignInMethod, currentSignInOptions, signInMethods } from '../providers/firebaseAuth';
import { projectsText } from '../i18n/areas/projects';

/** The words for a linking outcome, in the person's language. */
export function linkingProblemText(problem: LinkingProblem): string {
  const t = projectsText.accountLinks;
  return problem === 'use-existing-method' ? t.useExisting : problem === 'belongs-to-other-account' ? t.otherAccount
    : problem === 'already-added' ? t.alreadyAdded : t.recentSignIn;
}

export const methodName = (m: SignInMethod) => projectsText.accountLinks[m];

/**
 * Settings → Account: the ways into this one account (Google, Apple, Microsoft, email and password), and adding another. Adding
 * links it to the same account; it never creates a second one. Removing a way in is not offered, so nobody can lock
 * themselves out.
 */
export function SignInMethodsPanel({ disabled, hasEmail, className, onNote }: { disabled: boolean; hasEmail: boolean; className: string; onNote: (text: string) => void }) {
  const t = projectsText.accountLinks;
  const [methods, setMethods] = useState<SignInMethod[] | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void signInMethods().then(setMethods, () => setMethods([])); }, []);

  const options = currentSignInOptions();
  const available: SignInMethod[] = [
    ...options.filter((o) => o.available && o.provider !== 'password').map((o) => o.provider as SignInMethod),
    ...(hasEmail ? ['password' as const] : []),
  ];
  const toAdd = methods ? methodsToAdd(methods, [...new Set(available)]) : [];

  async function add(method: SignInMethod) {
    if (busy) return;
    setBusy(true);
    try {
      setMethods(await addSignInMethod(method, method === 'password' ? password : undefined));
      setPassword('');
      onNote(t.added(methodName(method)));
    } catch (error) {
      onNote(error instanceof LinkingError ? linkingProblemText(error.problem) : error instanceof Error ? error.message : t.recentSignIn);
    } finally { setBusy(false); }
  }

  if (!methods) return null;
  return (
    <section aria-labelledby="sign-in-methods-h" className="space-y-2 rounded-lg border border-[var(--account-border,#ffffff1a)] p-3" data-testid="sign-in-methods">
      <h4 id="sign-in-methods-h" className="font-medium text-[var(--account-foreground,#f4f4f5)]">{t.heading}</h4>
      <p>{methods.length ? t.current(methods.map(methodName).join(', ')) : t.none}</p>
      {toAdd.includes('password') && (
        <label className="block text-sm">{t.passwordLabel}
          <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6}
            className="mt-1 block min-h-11 w-full rounded-md border border-[var(--account-border,#ffffff26)] bg-[var(--account-field,#0000004d)] px-3 text-sm text-[var(--account-foreground,#f4f4f5)]" />
        </label>
      )}
      {toAdd.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {toAdd.map((m) => (
            <button key={m} type="button" className={className} disabled={disabled || busy || (m === 'password' && password.length < 6)} onClick={() => void add(m)}>
              {t.add(methodName(m))}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
