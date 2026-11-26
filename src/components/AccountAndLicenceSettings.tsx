import { useConnectivity } from '../providers/useConnectivity';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session, SignInProvider } from '../core/cloudInterfaces';
import { signInOptions } from '../core/signInOptions';
import { consumeLinkedMethod, firebaseAuth, isDesktopAppleConfigured, isDesktopGoogleConfigured, isSignInConfigured, signInPlatform, resendAccountVerification } from '../providers/firebaseAuth';
import { LinkingError } from '../core/accountLinking';
import { SignInMethodsPanel, linkingProblemText, methodName } from './SignInMethodsPanel';
import { AccountMergePanel } from './AccountMergePanel';
import { AccountDataPanel } from './AccountDataPanel';
import { accountDataClient } from '../providers/accountDataClient';
import { downloadExport } from '../providers/browserExport';
import { useAccess } from '../providers/useAccess';
import { accountLicenceDevices, activateFromAccount, attachDeviceKeyToAccount, consumeExpiredAccountNotice, deviceLicenceKey, deviceReleaseRefusal, freeAccountLicenceDevice, leaveAccount, licenceOnlineConfigured, removeLicence, saveLicence, useLicence } from '../providers/licenceStore';
import { BuyProPanel } from './BuyProPanel';
import type { LicenceStatus } from '../providers/licenceSync';
import { isDesktopApp, isMobileShell } from '../providers/desktopShell';
import { parseControlPlaneUrl } from '../core/licenceOnline';
import { readAccountOnlineSettings, setAccountAiConsent, type AccountCloudUsage, type ManagedAiConsentStatus } from '../providers/accountAiConsent';
import { DEV_PRO_PREVIEW_MODE } from '../providers/useAccess';
import { SignInMark } from './SignInMark';
import { POLICY_PATHS, SiteLink } from './SiteLink';
import { LicenceOnlineStatus } from './LicenceOnlineStatus';
import { projectsText as t } from '../i18n/areas/projects';
import { publicSiteUrl } from '../core/publicSite';
import { licencePlan } from '../core/licencePlan';


const field = 'block min-h-11 w-full rounded-md border border-[var(--account-border,#ffffff26)] bg-[var(--account-field,#0000004d)] px-3 text-sm text-[var(--account-foreground,#f4f4f5)]';
const action = 'min-h-11 rounded-md border border-[var(--account-border,#ffffff26)] px-3 text-sm text-[var(--account-foreground,#f4f4f5)] hover:bg-white/8 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-sky-300';
const storageSize = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'gigabyte', unitDisplay: 'short', maximumFractionDigits: 2 });

export function AccountAndLicenceSettings() {
  const licence = useLicence();
  const offline = useConnectivity() === 'offline';
  const [key, setKey] = useState('');
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const [account, setAccount] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountNote, setAccountNote] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<ManagedAiConsentStatus | null>(null);
  const [cloudUsage, setCloudUsage] = useState<AccountCloudUsage | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const aiRequest = useRef(0);
  const aiServer = parseControlPlaneUrl(import.meta.env.VITE_KESTREL_CONTROL_PLANE_URL);
  const { can } = useAccess();
  const [dataClient] = useState(() => accountDataClient(import.meta.env.VITE_KESTREL_CONTROL_PLANE_URL, () => firebaseAuth.idToken()));
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountDevices, setAccountDevices] = useState<LicenceStatus | null>(null);
  useEffect(() => { setAccountDevices(null); }, [account?.accountId]);
  const accountAction = useRef(false);

  async function runAccountAction(action: () => Promise<void>) {
    if (accountAction.current) return;
    accountAction.current = true;
    setAccountBusy(true);
    setAccountNote(null);
    try { await action(); } catch (error) {
      setAccountNote(error instanceof LinkingError ? linkingProblemText(error.problem) : error instanceof Error ? error.message : 'The account request did not complete.');
    } finally {
      accountAction.current = false;
      setAccountBusy(false);
    }
  }

  /** Signing in only creates a record. This asks whether the account has a purchase or gift, and says so plainly either way. */
  async function linkLicence() {
    if (offline) return;
    const token = await firebaseAuth.idToken(true).catch(() => null);
    if (!token) { setAccountNote('Could not check Pro online. You can keep using InFlight.'); return; }
    // A Pro key used on this device before signing up goes onto the account, with its devices. Never silently from
    // another account: then it is left where it is and the person is told.
    const linked = consumeLinkedMethod();
    const attached = await attachDeviceKeyToAccount(token);
    const before = [
      linked ? t.accountLinks.added(methodName(linked)) : '',
      attached === 'attached' ? t.accountLinks.keyAttached : attached === 'other' ? t.accountLinks.keyOther : '',
    ].filter(Boolean).join(' ');
    const result = await activateFromAccount(token);
    const text: Record<typeof result, string | null> = {
      pro: 'InFlight Pro is active on this device through your account.',
      free: 'Signed in. This account has no Pro licence yet, and signing in does not change what InFlight can do.',
      limit: 'This account\'s Pro licence is already on its maximum number of devices. Use Show account devices to free another device, then check Pro again.',
      revoked: 'This account\'s Pro licence is no longer active. Your local work is unaffected.',
      unreachable: 'Signed in, but the licence service could not be reached or the email is not verified yet. Check your email, then sign in again. InFlight keeps working.',
      not_set_up: 'This build is missing its online licence settings.',
    };
    setAccountNote([before, text[result]].filter(Boolean).join(' '));
  }

  useEffect(() => {
    // Set once by loadLicence() at launch when a stored account grant's offline window (30 days by
    // default) passed with no online check: this device was signed out of the account and dropped
    // to Basic. Local photos, edits and projects were never touched; only Pro confirmation and the
    // account session reset, so this asks the person to sign in again rather than show them as
    // still "signed in" with only Basic features.
    if (consumeExpiredAccountNotice()) {
      setAccountNote('Your Pro confirmation expired after 30 days offline, so this device signed out and is now on Basic. Your photos and edits here are unchanged. Sign in again to confirm Pro.');
    }
    void firebaseAuth.current().then((current) => { setAccount(current); }, () => setAccount(null));
  }, []);

  // A signed-in Firebase identity is not a control-plane session. Exchange its ID token
  // only while this dialog is open; read the live consent from the account, never from
  // localStorage or a licence grant. Ignore old responses after sign-out/account switch.
  useEffect(() => {
    const request = ++aiRequest.current;
    setAiStatus(null);
    setCloudUsage(null);
    setAiNote(null);
    if (!account || offline) { setAiBusy(false); return; }
    setAiBusy(true);
    void (async () => {
      try {
        const token = await firebaseAuth.idToken();
        const result = await readAccountOnlineSettings(aiServer, token);
        if (request === aiRequest.current) {
          setAiStatus(result.ai);
          setCloudUsage(result.cloud);
        }
      } catch {
        if (request === aiRequest.current) setAiNote('Could not check your online AI preference. No change has been made.');
      } finally {
        if (request === aiRequest.current) setAiBusy(false);
      }
    })();
    return () => { ++aiRequest.current; };
  // aiServer is build-time fixed; a change of signed-in identity must refresh consent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.accountId, offline]);

  async function changeAiConsent(consent: boolean) {
    if (offline || !account || !aiStatus || aiBusy) return;
    const request = ++aiRequest.current;
    setAiBusy(true);
    setAiNote(null);
    try {
      const token = await firebaseAuth.idToken();
      const confirmed = await setAccountAiConsent(aiServer, token, consent);
      if (request !== aiRequest.current) return;
      setAiStatus({ ...aiStatus, consent: confirmed });
      setAiNote(confirmed
        ? 'Online Gemini is allowed for this account. It only runs when you choose to use it.'
        : 'Online Gemini is switched off for this account. Your local photos and edits are unchanged.');
    } catch {
      if (request !== aiRequest.current) return;
      // A failed revoke may NOT be shown as successfully off. Require a fresh server read.
      setAiStatus(null);
      setAiNote('Could not confirm this change with the server. Do not use online AI until you have checked the setting again.');
    } finally {
      if (request === aiRequest.current) setAiBusy(false);
    }
  }

  async function retryAiConsent() {
    if (offline || !account || aiBusy) return;
    const request = ++aiRequest.current;
    setAiStatus(null);
    setAiBusy(true);
    setAiNote(null);
    try {
      const token = await firebaseAuth.idToken();
      const result = await readAccountOnlineSettings(aiServer, token);
      if (request === aiRequest.current) {
        setAiStatus(result.ai);
        setCloudUsage(result.cloud);
      }
    } catch {
      if (request === aiRequest.current) setAiNote('Online AI settings are unavailable. Nothing has changed.');
    } finally {
      if (request === aiRequest.current) setAiBusy(false);
    }
  }

  // Stable across renders so the checkout's waiting loop is not restarted by unrelated updates.
  const linkLicenceRef = useRef(linkLicence);
  linkLicenceRef.current = linkLicence;
  const buyProPaid = useCallback(() => runAccountActionRef.current(() => linkLicenceRef.current()), []);
  const runAccountActionRef = useRef(runAccountAction);
  runAccountActionRef.current = runAccountAction;

  function chooseSignIn(provider: SignInProvider) {
    if (offline) return;
    return runAccountAction(async () => {
      setAccount(await firebaseAuth.signIn(provider));
      await linkLicence();
    });
  }

  function emailAction(kind: 'in' | 'create' | 'reset') {
    if (offline) return;
    return runAccountAction(async () => {
      if (kind === 'reset') {
        await firebaseAuth.sendPasswordReset(email);
        setAccountNote('If that email has an account, a reset link is on its way.');
        return;
      }
      setAccount(await (kind === 'in' ? firebaseAuth.signInWithEmail(email, password) : firebaseAuth.createAccount(email, password)));
      setPassword('');
      if (kind === 'create') setAccountNote('Check your email to verify the address, then check Pro. If nothing arrives, use Resend verification email.');
      else await linkLicence();
    });
  }

  function resendVerification() {
    if (offline) return;
    return runAccountAction(async () => {
      const result = await resendAccountVerification();
      if (result === 'already_verified') await linkLicence();
      else setAccountNote('Verification email sent. Open the link, then choose Check Pro online.');
    });
  }

  function showAccountDevices() {
    if (offline || !account) return;
    return runAccountAction(async () => {
      const token = await firebaseAuth.idToken(true);
      const devices = token ? await accountLicenceDevices(token) : null;
      setAccountDevices(devices);
      if (!devices) setAccountNote('Could not check your account devices. Try again when online.');
    });
  }

  function releaseAccountDevice(activationId: string) {
    if (offline || !account || !accountDevices?.devices.some(d => d.activationId === activationId && !d.thisDevice)) return;
    if (!window.confirm('Free this device slot? That device may keep using its offline grant until it expires. Your photographs and edits are unchanged.')) return;
    return runAccountAction(async () => {
      const token = await firebaseAuth.idToken(true);
      if (!token || !(await freeAccountLicenceDevice(token, activationId))) {
        setAccountNote(deviceReleaseRefusal() ?? 'Could not confirm that the device slot was freed. Check the list again.');
        return;
      }
      setAccountDevices(await accountLicenceDevices(token));
      setAccountNote('Device slot freed. Choose Check Pro online to activate this device.');
    });
  }

  function chooseSignOut() {
    return runAccountAction(async () => {
      await firebaseAuth.signOut();
      ++aiRequest.current;
      setAiStatus(null);
      setCloudUsage(null);
      setAiBusy(false);
      setAiNote(null);
      leaveAccount();
      setAccount(null);
      setAccountDevices(null);
      setAccountNote('Signed out of InFlight.');
    });
  }

  // The plan is read from the licence store all the time, so it is right before (and without) a check online.
  const plan = licencePlan(licence);
  const planText = plan.kind === 'checking' ? t.licence.planChecking
    : plan.kind === 'pro-key' ? t.licence.planProKey
    : plan.kind === 'pro-account' ? [t.licence.planProAccount, plan.offlineUntilMs ? t.licence.planOfflineUntil(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(plan.offlineUntilMs)) : ''].filter(Boolean).join(' ')
    : t.licence.planFree(DEV_PRO_PREVIEW_MODE);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await saveLicence(key);
    if (result.ok) { setKey(''); setNote({ text: t.licence.thanks, good: true }); } else setNote({ text: result.message, good: false });
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="account-h" className="space-y-3">
        <h3 id="account-h" className="font-medium text-[var(--account-foreground,#f4f4f5)]">Account (optional)</h3>
        {offline && <p role="status">{t.connections.health.offline} · {t.connections.advice.offline}</p>}
        <div data-testid="licence-plan" data-plan={plan.kind} className="space-y-1 rounded-lg border border-[var(--account-border,#ffffff1a)] p-3">
          <h4 className="font-medium text-[var(--account-foreground,#f4f4f5)]">{t.licence.planHeading}</h4>
          <p>{planText}</p>
        </div>
        {account ? (
          <>
            <p role="status">Signed in with {account.provider === 'apple' ? 'Apple' : account.provider === 'password' ? 'email' : 'Google'}{account.email ? ` as ${account.email}` : ''}.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={action} disabled={offline || accountBusy} onClick={() => void runAccountAction(linkLicence)}>Check Pro online</button>
              {account.provider === 'password' && <button type="button" className={action} disabled={offline || accountBusy} onClick={() => void resendVerification()}>Resend verification email</button>}
              <button type="button" className={action} disabled={accountBusy} onClick={() => void chooseSignOut()}>Sign out</button>
              <button type="button" className={action} disabled={offline || accountBusy} onClick={() => void showAccountDevices()}>Show account devices</button>
            </div>
            <SignInMethodsPanel key={account.accountId} disabled={offline || accountBusy} hasEmail={Boolean(account.email)} className={action} onNote={setAccountNote} />
            <AccountMergePanel key={'merge-' + account.accountId} disabled={offline || accountBusy} className={action} onNote={setAccountNote} />
            {can('accountData') && <AccountDataPanel key={'data-' + account.accountId} client={dataClient} disabled={offline || accountBusy} className={action} onNote={setAccountNote} save={downloadExport} />}
            <p className="text-xs text-[var(--account-muted,#a1a1aa)]">{t.accountLinks.localStay}</p>
            {!offline && accountDevices && (
              <section aria-label="Account Pro devices" className="space-y-2 rounded-lg border border-[var(--account-border,#ffffff1a)] p-3">
                <h4 className="font-medium">Account Pro devices</h4>
                {accountDevices.status === 'unknown' ? <p>No active account Pro licence.</p> : <>
                  <p>{accountDevices.devices.length} of {accountDevices.maxDevices} device slots in use.</p>
                  <ul className="space-y-2">
                    {accountDevices.devices.map(device => (
                      <li key={device.activationId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--account-border,#ffffff1a)] px-3 py-2">
                        <span>{device.platform}{device.thisDevice ? ' · This device' : ''}<span className="block text-xs">{device.appVersion} · Last seen {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(device.lastSeenMs)}</span></span>
                        {!device.thisDevice && <button type="button" className={action} disabled={accountBusy} aria-label={'Free ' + device.platform + ' device'} onClick={() => void releaseAccountDevice(device.activationId)}>Free device</button>}
                      </li>
                    ))}
                  </ul>
                </>}
              </section>
            )}
            {licenceOnlineConfigured() && !((licence.status === 'valid' || licence.status === 'account') && licence.access.pro) && !isMobileShell() && (
              <BuyProPanel offline={offline} onPaid={buyProPaid} />
            )}
          </>
        ) : (
          <>
            <p>Signing in lets you manage optional account features, including the online AI helper when available. Importing, culling, editing and exporting never need an account.</p>
            <p data-testid="account-local-stay">{t.accountLinks.localStay}</p>
            <div className="flex flex-wrap gap-2">
              {signInOptions(signInPlatform(), isSignInConfigured(), isDesktopGoogleConfigured(), isDesktopAppleConfigured()).map((option) => (
                <button key={option.provider} type="button" className={`${action} inline-flex items-center gap-2 disabled:opacity-60`} disabled={offline || accountBusy || !option.available} aria-describedby={option.reason ? 'account-reason' : undefined} onClick={() => void chooseSignIn(option.provider)}><SignInMark provider={option.provider === 'apple' ? 'apple' : 'google'} />{option.label}</button>
              ))}
            </div>
            {isSignInConfigured() && (
              <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void emailAction('in'); }}>
                <label className="block">Email
                  <input className={`${field} mt-1`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
                </label>
                <label className="block">Password
                  <input className={`${field} mt-1`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={action} disabled={offline || accountBusy || !email.trim() || !password}>Sign in</button>
                  <button type="button" className={action} disabled={offline || accountBusy || !email.trim() || !password} onClick={() => void emailAction('create')}>Create account</button>
                  <button type="button" className={action} disabled={offline || accountBusy || !email.trim()} onClick={() => void emailAction('reset')}>Reset password</button>
                </div>
              </form>
            )}
            <p className="text-xs text-[var(--account-muted,#a1a1aa)]" data-testid="account-terms-notice">
              By creating an account or signing in, you agree to the <SiteLink path={POLICY_PATHS.terms} className="underline">terms</SiteLink> and
              {' '}<SiteLink path={POLICY_PATHS.acceptableUse} className="underline">acceptable use policy</SiteLink>. The
              {' '}<SiteLink path={POLICY_PATHS.privacy} className="underline">privacy notice</SiteLink> says what we keep and how to delete it.
            </p>
            {(() => { const reason = signInOptions(signInPlatform(), isSignInConfigured(), isDesktopGoogleConfigured(), isDesktopAppleConfigured()).find((o) => o.reason)?.reason; return reason ? <p id="account-reason" className="text-xs text-[var(--account-muted,#a1a1aa)]">{reason}</p> : null; })()}
          </>
        )}
        {accountBusy && <p role="status">Working on your account…</p>}
        {accountNote && <p role="status" className="text-[var(--account-warning,#fde68a)]">{accountNote}</p>}
        {account && (
          <div className="space-y-3 rounded-lg border border-[var(--account-border,#ffffff1a)] p-3" aria-label="Optional online AI settings">
            <h4 className="font-medium text-[var(--account-foreground,#f4f4f5)]">Online Gemini helper (optional)</h4>
            <p className="text-xs text-[var(--account-text,#d4d4d8)]">
              Off by default. When allowed, the helper can check a small image without camera metadata,
              but only when you choose an online AI action. No original photo is automatically uploaded.
              Culling, editing and exporting still work offline.
            </p>
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" aria-label="Allow optional online Gemini helper"
                className="h-5 w-5 accent-sky-300"
                checked={aiStatus?.consent === true}
                disabled={offline || aiBusy || !aiStatus}
                onChange={(event) => void changeAiConsent(event.target.checked)} />
              <span>{aiBusy ? 'Checking online setting…' : aiStatus?.consent === true ? 'Allowed for this account' :
                aiStatus ? 'Off for this account' : 'Waiting for the account setting'}</span>
            </label>
            {aiStatus && !aiStatus.planAvailable && (
              <p className="text-xs text-[var(--account-muted,#a1a1aa)]">Your current plan does not include the hosted helper. Changing this preference does not buy a plan.</p>
            )}
            {!aiBusy && !aiStatus && (
              <button type="button" className={action} disabled={offline} onClick={() => void retryAiConsent()}>
                Check online AI setting again
              </button>
            )}
            {aiNote && <p role="status" className="text-[var(--account-warning,#fde68a)]">{aiNote}</p>}
          </div>
        )}
        {account && cloudUsage && (
          <section className="space-y-2 rounded-lg border border-[var(--account-border,#ffffff1a)] p-3" aria-label="Cloud storage allowance">
            <h4 className="font-medium text-[var(--account-foreground,#f4f4f5)]">Cloud storage</h4>
            {cloudUsage.state === 'available' ? <>
              <p>{storageSize.format(cloudUsage.bytesUsed / 1_000_000_000)} used of {storageSize.format(cloudUsage.bytesQuota / 1_000_000_000)}</p>
              {cloudUsage.bytesUsed >= cloudUsage.bytesQuota && (
                <p role="alert">Your cloud storage is full. New uploads are paused. You can still open and download your saved copies.</p>
              )}
            </> : <p>Could not check your cloud storage allowance. Check again when you’re online.</p>}
          </section>
        )}
      </section>
      <section aria-labelledby="licence-h" className="space-y-3">
        <h3 id="licence-h" className="font-medium text-[var(--account-foreground,#f4f4f5)]">{t.licence.licenceKey}</h3>
        {licence.status === 'account' && licence.standing.kind === 'active' && licence.access.pro && (
          <p role="status">{plan.kind === 'pro-account' && plan.owned
            ? 'InFlight Pro is yours on this device. It keeps working with or without a connection.'
            : <>InFlight Pro is active on this device. Offline until {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(licence.standing.grant.offlineUntilMs)}.</>}</p>
        )}
        {licence.status === 'valid'
          ? <>{licence.access.pro && <p role="status">{t.licence.unlocked}</p>}<LicenceOnlineStatus licence={licence} /><KeptKey /></>
          : (licence.status !== 'account' || !licence.access.pro) && <p>{t.licence.notUnlocked(DEV_PRO_PREVIEW_MODE)}</p>}
        {licence.status === 'invalid' && <p role="alert" className="text-[var(--account-warning,#fde68a)]">{licence.message}</p>}
        {licence.status !== 'valid' ? (
          <form onSubmit={(event) => void submit(event)} className="space-y-2">
            <label className="block">{t.licence.licenceKey}
              <input className={`${field} mt-1 font-mono`} value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="KESTREL1.…" />
            </label>
            <button type="submit" className={action} disabled={!key.trim()}>{t.licence.unlock}</button>
          </form>
        ) : (
          <button type="button" className={action} onClick={() => { setNote(null); void removeLicence(); }}>{t.licence.removeKey}</button>
        )}
        {licence.status !== 'valid' && !isMobileShell() && !offline && (
          <a href={publicSiteUrl('/#pricing')} target="_blank" rel="noopener noreferrer"
            className={`${action} inline-flex items-center`}
            onClick={(event) => {
              if (!isDesktopApp()) return;
              event.preventDefault();
              const url = event.currentTarget.href;
              void import('@tauri-apps/plugin-opener')
                .then(({ openUrl }) => openUrl(url))
                .catch(() => setNote({ text: t.licence.pricingUnavailable, good: false }));
            }}>{t.licence.viewProPricing}</a>
        )}
        {note && <p role={note.good ? 'status' : 'alert'} className={note.good ? 'text-[var(--account-foreground,#a7f3d0)]' : 'text-[var(--account-warning,#fde68a)]'}>{note.text}</p>}
        <p className="text-xs text-[var(--account-muted,#a1a1aa)]">{t.licence.noAccount}</p>
      </section>
    </div>
  );
}

/** The key kept on this device, so the owner can copy it for another device or keep it safe. */
function KeptKey() {
  const [copied, setCopied] = useState(false);
  const key = deviceLicenceKey();
  if (!key) return null;
  return (
    <div className="space-y-1">
      <label className="block">{t.licence.yourKey}
        <input id="kept-licence-key" readOnly value={key} onFocus={(event) => event.currentTarget.select()}
          className="mt-1 w-full rounded-md border border-white/15 bg-black/20 px-3 py-2 font-mono text-xs text-zinc-100" />
      </label>
      <p className="text-xs text-[var(--account-muted,#a1a1aa)]">{t.licence.yourKeyHint}</p>
      <button type="button" className="min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300"
        onClick={() => {
          navigator.clipboard?.writeText(key).then(() => setCopied(true), () => (document.getElementById('kept-licence-key') as HTMLInputElement | null)?.select());
        }}>{copied ? t.licence.keyCopied : t.licence.copyKey}</button>
    </div>
  );
}
