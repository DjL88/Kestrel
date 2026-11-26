# Launch welcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In V2, the launch splash grows into a welcome screen. It offers first launch, signed-in welcome back and returning guest states, plus sign in (which is also sign up) with Apple, Google and email.

**Architecture:** Pure decisions live in `src/core/launchWelcome.ts`: which state to show, and what to do after an email sign-in fails. A small local memory in `src/providers/launchMemory.ts` holds the profile, last project, launched flag and skip choice. The welcome screen is a V2 component that `Splash.tsx` lazy-loads into its own layer when V2 is on. The choice made there reaches V2 through a tiny intent store, so the two never import each other's internals. Sign-in code shared with Settings moves into `src/providers/accountSignIn.ts`.

**Tech Stack:** React 19 + TypeScript, Tailwind classes with V2 tokens, `lottie-web` (light player), Firebase Auth (lazy), `node:test` with `tsx` for unit tests, Playwright for browser tests.

**Spec:** `docs/superpowers/specs/2026-11-25-launch-welcome-design.md`

## Global Constraints
- V2 only. V1 (`?v2=0`) keeps today's `Splash` behaviour byte for byte: same phases, same skip, still logo.
- Nothing at start-up may load Firebase or wait for the network. `firebaseAuth` is imported only by sign-in actions and the one-off quiet profile check after the welcome is gone.
- Every new local key starts with `inflight.`, so `eraseDeviceData` (prefixes `kestrel`, `inflight`) removes it.
- Never sign anyone out except through "Not you? Sign out", which runs the same code as Settings sign-out.
- British English. All copy goes through V2 strings (`src/i18n/areas/v2/source.ts`). Every full language gets a draft translation, or `src/core/locale.test.ts` fails.
- Buttons at least 44 px tall, visible focus, no colour-only cues (Pro shown as text plus a dot), Escape closes the sign-in panel.
- Reduced motion: no Lottie and no rise. The still stacked logo sits in its top position and the welcome is shown at once.
- Automated runs (`navigator.webdriver`) still skip splash and welcome. `?splash` forces both.

## Review Focus
1. **The last project was deleted since its snapshot was saved.** The card must open the projects list with the notice "That project is no longer here", not a blank editor. Test in Task 4.
2. **Launching offline.** The welcome renders, the sign-in buttons are disabled, and the offline message is shown. Test in Task 8.
3. **Shared computer, Keep me signed in unticked.** The profile must live in `sessionStorage` only, so a later browser session shows the guest state. Test in Task 2.
4. **A key press during the animation.** It must jump to the welcome, not to the app, and must not trigger a shortcut in the workspace underneath. The existing `tests/v2-splash.spec.ts` key test changes to this. Test in Task 7.
5. **Tab and keys while the welcome shows.** Focus must stay inside the welcome layer, and the workspace under it must not react to keys. Test in Task 8.

---

### Task 1: Pure welcome decisions

**Files:**
- Create: `src/core/launchWelcome.ts`
- Test: `src/core/launchWelcome.test.ts`

**Interfaces:**
- Produces:
  - `type LaunchProfile = { signedIn: true; displayName: string | null; initial: string | null }`
  - `type LastProject = { id: string; name: string; photoCount: number; editedAt: string }` (ISO date)
  - `type WelcomeState = 'first' | 'signedIn' | 'guest'`
  - `type WelcomeInput = { profile: LaunchProfile | null; accountInLicence: boolean; launchedBefore: boolean; hasProjects: boolean }`
  - `chooseWelcome(input: WelcomeInput): WelcomeState`
  - `shouldSkipWelcome(state: WelcomeState, skipChosen: boolean): boolean` (true only for `'guest'` with `skipChosen`)
  - `profileFromSession(session: { email?: string; displayName?: string }): LaunchProfile`
  - `type EmailFailure = 'wrong-or-unknown' | 'in-use' | 'weak-password' | 'invalid-email' | 'offline' | 'other'`
  - `emailNextStep(stage: 'signIn' | 'create', failure: EmailFailure): 'offer-create' | 'say-wrong-password' | 'show-error'`

- [ ] **Step 1: Write the failing tests** (`node:test` + `assert/strict`, same style as `src/core/splashRules.test.ts`)
  - `chooseWelcome`: profile → `'signedIn'`. No profile but `accountInLicence` → `'signedIn'`. Neither, with `launchedBefore` or `hasProjects` → `'guest'`. Neither, and both false → `'first'`.
  - `shouldSkipWelcome('guest', true) === true`, `shouldSkipWelcome('signedIn', true) === false`, `shouldSkipWelcome('first', true) === false`.
  - `profileFromSession({ displayName: 'Sam Lee', email: 'x@y.z' })` → `{ signedIn: true, displayName: 'Sam Lee', initial: 'S' }`. `profileFromSession({ email: 'river.k@example.com' })` → displayName `'river.k'`, initial `'R'`. `profileFromSession({})` → `{ signedIn: true, displayName: null, initial: null }`.
  - `emailNextStep('signIn','wrong-or-unknown') === 'offer-create'`, `emailNextStep('create','in-use') === 'say-wrong-password'`, `emailNextStep('signIn','offline') === 'show-error'`.
- [ ] **Step 2: Run them to see them fail.** `node --import tsx --test src/core/launchWelcome.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement the five functions in `src/core/launchWelcome.ts`.** No imports from providers, DOM or React.
- [ ] **Step 4: Run the tests.** Same command. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "Launch welcome: pure state chooser and email sign-in decision"`

### Task 2: Launch memory (local, instant, erasable)

**Files:**
- Create: `src/providers/launchMemory.ts`
- Test: `src/providers/launchMemory.test.ts`

**Interfaces:**
- Consumes: `LaunchProfile`, `LastProject` from Task 1.
- Produces, all taking an optional `{ local: StorageLike; session: StorageLike }` for tests (defaulting to `localStorage` and `sessionStorage`, and never throwing when storage is unavailable):
  - `readProfile(): LaunchProfile | null` (reads session first, then local)
  - `writeProfile(profile: LaunchProfile, keep: boolean): void` (keep → local and clears session; not keep → session and clears local)
  - `clearProfile(): void`
  - `readLastProject(): LastProject | null` / `writeLastProject(p: LastProject): void`
  - `markLaunched(): void` / `launchedBefore(): boolean`
  - `skipChosen(): boolean` / `setSkipChosen(skip: boolean): void`
  - `profileChecked(): boolean` / `markProfileChecked(): void`
  - `priorUseDetected(): boolean`: true when local storage holds any device key (`isDeviceKey`) that doesn't start with `inflight.launch.`. Someone upgrading has theme, layout or V2 keys, so they count as returning (spec call 5).
  - Keys: `inflight.launch.profile`, `inflight.launch.lastProject`, `inflight.launch.launched`, `inflight.launch.skip`, `inflight.launch.profileChecked`

- [ ] **Step 1: Write the failing tests** using an in-memory `StorageLike`.
  - `writeProfile(p, false)` puts it in session only: local has no `inflight.launch.profile`, and `readProfile()` deep-equals `p`. After the session store is emptied (a new browser session), `readProfile()` is `null`. This is Review Focus 3.
  - `writeProfile(p, true)` → local only. `clearProfile()` removes both.
  - Corrupt JSON in either key → `readProfile()` / `readLastProject()` return `null`.
  - Every key written passes `isDeviceKey` from `src/v2/engineClient/eraseDeviceData.ts`.
  - `priorUseDetected()` is false for empty storage and for storage holding only `inflight.launch.*` keys. It is true with `inflight.v2` or `kestrel-theme` present.
- [ ] **Step 2: Run them to see them fail.** `node --import tsx --test src/providers/launchMemory.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/providers/launchMemory.ts`.**
- [ ] **Step 4: Run the tests.** Expected: pass.
- [ ] **Step 5: Commit.** `git commit -m "Launch welcome: local launch memory, erasable with device data"`

### Task 3: Shared sign-in (also sign-up), Keep me signed in, Settings writes the profile

**Files:**
- Create: `src/providers/accountSignIn.ts`
- Modify: `src/providers/firebaseAuth.ts` (add `setKeepSignedIn`, classify email errors)
- Modify: `src/components/AccountAndLicenceSettings.tsx` (use the shared functions; write and clear the profile)
- Test: `src/providers/accountSignIn.test.ts`

**Interfaces:**
- Consumes: `emailNextStep`, `profileFromSession`, `EmailFailure` (Task 1); `writeProfile`, `clearProfile` (Task 2).
- Produces:
  - `firebaseAuth.setKeepSignedIn(keep: boolean): Promise<void>`. On web, sets `indexedDBLocalPersistence` when keep is true and `browserSessionPersistence` when false, on the existing instance. A no-op off the web.
  - `emailFailureOf(error: unknown): EmailFailure` in `firebaseAuth.ts`. Mapping: `auth/invalid-credential`, `auth/wrong-password`, `auth/user-not-found` → `'wrong-or-unknown'`; `auth/email-already-in-use` → `'in-use'`; `auth/weak-password` → `'weak-password'`; `auth/invalid-email` → `'invalid-email'`; `auth/network-request-failed` → `'offline'`; else `'other'`. To keep the code, the existing `withAuth` keeps the original error on `cause`.
  - `type LicenceOutcome = 'pro' | 'free' | 'limit' | 'revoked' | 'unreachable' | 'not_set_up' | 'no_token'`
  - `linkLicenceOutcome(deps?): Promise<LicenceOutcome>` (the body of today's `linkLicence` minus the messages)
  - `signInWithProvider(provider: 'apple' | 'google', keep: boolean): Promise<{ outcome: LicenceOutcome }>`. Writes the profile with `keep`.
  - `type EmailResult = { kind: 'signed-in'; outcome: LicenceOutcome } | { kind: 'offer-create' } | { kind: 'created' } | { kind: 'wrong-password' } | { kind: 'error'; failure: EmailFailure }`
  - `continueWithEmail(email: string, password: string, keep: boolean): Promise<EmailResult>`. Tries sign-in, and on failure returns `emailNextStep`'s answer.
  - `createWithEmail(email: string, password: string, keep: boolean): Promise<EmailResult>`. Returns `'created'` (verification sent, profile written) or `'wrong-password'` when the email is in use.
  - `signOutEverywhere(): Promise<void>`. Runs `firebaseAuth.signOut()` (ignoring a network failure, since local state still clears), then `leaveAccount()`, then `clearProfile()`.
  - `availableProviders(): ('apple' | 'google' | 'email')[]`. Email always. Apple and Google when `signInPlatform() === 'web'`, or `'desktop'` with `isDesktopAppleConfigured()` / `isDesktopGoogleConfigured()` respectively.
  - Every function takes an optional `deps` object (auth, licence, memory) so tests run without Firebase.

- [ ] **Step 1: Write the failing tests** with fake deps.
  - `continueWithEmail` where sign-in throws a `wrong-or-unknown` failure returns `{ kind: 'offer-create' }` and writes no profile.
  - `createWithEmail` where create throws `'in-use'` → `{ kind: 'wrong-password' }`.
  - A successful `continueWithEmail` → `{ kind: 'signed-in', outcome: 'pro' }`, and the fake memory got `writeProfile({ signedIn: true, displayName: 'sam', initial: 'S' }, false)` for `keep = false`.
  - `signOutEverywhere` where `signOut` rejects still calls `leaveAccount` and `clearProfile`.
  - `availableProviders` for ios/android → `['email']`. For web → `['apple','google','email']`.
- [ ] **Step 2: Run them to see them fail.** `node --import tsx --test src/providers/accountSignIn.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `setKeepSignedIn` and `emailFailureOf`** in `firebaseAuth.ts`, then `accountSignIn.ts`.
- [ ] **Step 4: Refactor `AccountAndLicenceSettings.tsx`.**
  - `linkLicence` maps `linkLicenceOutcome()` to its existing messages. Keep the text unchanged, plus `'no_token'` → "Could not check Pro online. You can keep using InFlight."
  - `chooseSignIn` and `emailAction('in'|'create')` call the shared functions with `keep = true`. Settings keeps "always remember".
  - `chooseSignOut` calls `signOutEverywhere()` before its own local state resets.
  - Visible behaviour stays the same.
- [ ] **Step 5: Run the checks.** `node --import tsx --test src/providers/accountSignIn.test.ts`, then `npm run lint`. Expected: pass, no type errors.
- [ ] **Step 6: Commit.** `git commit -m "Account: shared sign-in that also signs up; Settings writes the launch profile"`

### Task 4: Last project and the launch intent bridge into V2

**Files:**
- Create: `src/v2/launchIntent.ts`
- Test: `src/v2/launchIntent.test.ts`
- Modify: `src/v2/engineClient/useEngineWorkspace.ts` (save the snapshot when a project opens; consume the intent)

**Interfaces:**
- Consumes: `writeLastProject`, `readLastProject` (Task 2), `LastProject` (Task 1).
- Produces:
  - `type LaunchIntent = { kind: 'project'; id: string } | { kind: 'projects' }`
  - `requestLaunch(intent: LaunchIntent): void`, `takeLaunchIntent(): LaunchIntent | null` (read once), `onLaunchIntent(fn: () => void): () => void`
  - `resolveLaunchIntent(intent: LaunchIntent, projectIds: readonly string[]): { open: string | null; notice: 'missing-project' | null }` (pure)

- [ ] **Step 1: Write the failing tests.**
  - `resolveLaunchIntent({ kind: 'project', id: 'a' }, ['a','b'])` → `{ open: 'a', notice: null }`.
  - `resolveLaunchIntent({ kind: 'project', id: 'gone' }, ['a'])` → `{ open: null, notice: 'missing-project' }`. This is Review Focus 1.
  - `resolveLaunchIntent({ kind: 'projects' }, [])` → `{ open: null, notice: null }`.
  - `takeLaunchIntent()` returns a requested intent once, then `null`. `onLaunchIntent` fires on request.
- [ ] **Step 2: Run them to see them fail.** `node --import tsx --test src/v2/launchIntent.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/v2/launchIntent.ts`.**
- [ ] **Step 4: Wire it into `useEngineWorkspace.ts`.**
  - `openProject(id)` saves `writeLastProject({ id, name, photoCount, editedAt: updatedAt })` from the project summary.
  - Once projects have loaded, and whenever `onLaunchIntent` fires, take the intent and resolve it against the loaded ids. Open the project, or stay on the hub. For `'missing-project'`, show the hub notice string `welcome.missingProject` (Task 5) through the workspace's existing notice mechanism.
- [ ] **Step 5: Run the checks.** `node --import tsx --test src/v2/launchIntent.test.ts`, then `npm run lint`. Expected: pass.
- [ ] **Step 6: Commit.** `git commit -m "V2: remember the last project and accept a launch choice from the welcome"`

### Task 5: Welcome strings in every language

**Files:**
- Modify: `src/i18n/areas/v2/source.ts` (new `welcome` block)
- Modify: every language file in `src/i18n/areas/v2/` (`cy da de en-CA en-US es fi fr ga gd is it nb nl pt sv`), adding draft translations for the same keys

**Interfaces:**
- Produces `STRINGS.welcome` keys, British English source copied from the mockups and spec:
  - `firstTitle`: "Welcome to InFlight"
  - `firstBody`: "Sort, edit and export your photos. Everything stays on this device."
  - `offlineNote`: "No account needed. Works fully offline."
  - `welcomeBack`: "Welcome back"
  - `welcomeBackName`: "Welcome back, {name}"
  - `guestBody`: "Sign in to back up your catalogue and use Pro on this device."
  - `proConfirmed`: "Pro · confirmed on this device"
  - `pickUp`: "Pick up where you left off"
  - `goToProjects`: "Go to my projects"
  - `continueGuest`: "Continue as guest"
  - `signIn`: "Sign in"
  - `notYou`: "Not you? Sign out"
  - `skipNextTime`: "Go straight to my projects next time"
  - `withApple`: "Continue with Apple"
  - `withGoogle`: "Continue with Google"
  - `withEmail`: "Continue with email"
  - `keepSignedIn`: "Keep me signed in on this browser"
  - `email`: "Email"
  - `password`: "Password"
  - `back`: "Back"
  - `offerCreate`: "No InFlight account for {email} yet, or the password is wrong. Create a new account with this email?"
  - `createAccount`: "Create account"
  - `tryAgain`: "Try again"
  - `wrongPassword`: "That password doesn't match this account."
  - `forgotPassword`: "Forgot password?"
  - `offlineSignIn`: "Sign in needs a connection. You can continue as a guest and sign in later from Settings."
  - `outcome`: an object with one line per `LicenceOutcome`:
    - `pro`: "Pro is on for this device."
    - `free`: "Signed in. This account has no Pro licence yet."
    - `limit`: "This account's Pro is on its maximum number of devices. Manage devices in Settings."
    - `revoked`: "This account's Pro licence is no longer active. Your work is unaffected."
    - `unreachable`: "Signed in. Pro couldn't be checked just now. InFlight keeps working."
    - `not_set_up`: "This build is missing its online licence settings."
    - `no_token`: "Signed in. Pro couldn't be checked just now. InFlight keeps working."
  - `created`: "Account created. Check your email to verify it, then Pro turns on."
  - `missingProject`: "That project is no longer here."
  - `showOnLaunch`: "Show the welcome screen on launch" (Settings switch)

- [ ] **Step 1: Add the block to `source.ts`, and draft translations to each language file.** Mark them drafts the way the existing V2 files do.
- [ ] **Step 2: Run the checks.** `node --import tsx --test src/core/locale.test.ts src/i18n/areas/v2/fallback.test.ts`. Expected: pass, with no missing or unknown keys.
- [ ] **Step 3: Commit.** `git commit -m "V2 strings: launch welcome (drafts for every language)"`

### Task 6: The welcome screen component

**Files:**
- Create: `src/v2/ui/screens/LaunchWelcome.tsx`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: `default function LaunchWelcome(props: { state: WelcomeState; profile: LaunchProfile | null; lastProject: LastProject | null; isPro: boolean; online: boolean; light: boolean; onDone: (intent: LaunchIntent) => void; onSignedOut: () => void }): JSX.Element`.

Layout and behaviour as in mockup version 2:
- **States.**
  - `'first'`: title and body, Continue as guest (primary), Sign in (secondary), offline note.
  - `'signedIn'`: initial avatar (hidden when `initial` is null), greeting (`welcomeBackName`, or `welcomeBack` without a name), Pro pill when `isPro`, the "Pick up where you left off" card (highlighted, the primary action) when `lastProject` exists, else "Go to my projects" as primary, then the `notYou` link.
  - `'guest'`: `guestBody`, the card when present, Continue as guest, Sign in, and the `skipNextTime` tick box (writes `setSkipChosen`).
- **Sign-in panel.** It replaces the action area. `availableProviders()` buttons, `keepSignedIn` (only when `signInPlatform() === 'web'`, ticked by default and placed above the buttons), the email form, the offer-create confirm, a calm outcome line, and Back plus Escape. When `online` is false, every sign-in button is disabled and `offlineSignIn` is shown. After success the panel closes and the screen shows the `'signedIn'` state with the outcome line under the greeting.
- **Actions.** Card → `onDone({ kind: 'project', id })`. Go to projects and Continue as guest → `onDone({ kind: 'projects' })`. Continue as guest also `markLaunched()`. `notYou` → `signOutEverywhere()`, then `onSignedOut()`.
- **Accessibility.** The content is a `main` landmark with an `h1`. Focus starts on the primary action. Tab is trapped inside the layer (Review Focus 5). Every control is a native `button`, `input` or `label` at least 44 px tall. Text uses `STRINGS.welcome`.

- [ ] **Step 1: Build the component.** It has no unit test of its own: its logic lives in Tasks 1–4, and Task 8's browser specs cover its behaviour.
- [ ] **Step 2: Run the checks.** `npm run lint`. Expected: no errors.
- [ ] **Step 3: Commit.** `git commit -m "V2: launch welcome screen (first launch, welcome back, guest, sign in)"`

### Task 7: The splash grows into the welcome (V2), V1 unchanged

**Files:**
- Modify: `src/components/Splash.tsx`
- Modify: `src/main.tsx` (pass `welcome={v2Enabled()}`)
- Modify: `tests/v2-splash.spec.ts` (key-press test changes to the new behaviour)

**Interfaces:**
- Consumes: Task 6 (lazy `import('../v2/ui/screens/LaunchWelcome')`), Task 1 (`chooseWelcome`, `shouldSkipWelcome`), Task 2 (memory), Task 4 (`requestLaunch`).
- Produces: `Splash({ welcome?: boolean })`. With `welcome` false, the behaviour is exactly today's.

Behaviour with `welcome`:
- **Choosing the state.** At mount (synchronously): `chooseWelcome({ profile: readProfile(), accountInLicence: licence status is 'account' via useLicence, launchedBefore: launchedBefore(), hasProjects: readLastProject() !== null || priorUseDetected() })`. If `shouldSkipWelcome(...)`, behave exactly as today.
- **Phases.** `animating` → `welcome` → `leaving`.
  - On animation complete, or on any key or pointer during `animating`: go to the last frame (`goToAndStop(op - 1, true)`), then switch to `welcome`. The key is consumed (`preventDefault` and `stopPropagation` in capture phase), so no workspace shortcut fires (Review Focus 4).
  - In `welcome`, the Lottie host eases to the top position over 400 ms (`transform: translateY(...) scale(0.62)` and `ease-out`). The welcome content fades in over 300 ms after 150 ms. Remove `aria-hidden` from the layer.
  - `onDone(intent)` → `requestLaunch(intent)`, `markLaunched()`, then `leaving` (today's 300 ms fade), then unmount.
- **Reduced motion.** No Lottie. The still stacked logo is in the top position and the welcome is visible at once.
- **Quiet profile check.** After unmount, if `readProfile()` is null and `!profileChecked()`: dynamically import `firebaseAuth`, call `current()`, write `profileFromSession` with `keep: true` when a session exists, then `markProfileChecked()`. Wrap it in try/catch, and never block.
- **Tests.** Update `tests/v2-splash.spec.ts`:
  - "plays the launch animation, then leaves the workspace ready" becomes: plays, then shows `getByRole('heading', { name: 'Welcome to InFlight' })`. Clicking Continue as guest leaves the workspace ready.
  - "a key press skips the splash" becomes: a key press shows the welcome heading at once, and `All photos grid view` stays absent.
  - "reduced motion" asserts the welcome heading and no `splash-animation`.
  - `tests/splash.spec.ts` (V1) is untouched and must still pass.

- [ ] **Step 1: Update the specs in `tests/v2-splash.spec.ts` as above, and run them to see them fail.** `npx playwright test tests/v2-splash.spec.ts --project=desktop`. Expected: FAIL (no welcome heading).
- [ ] **Step 2: Implement the phases in `Splash.tsx` and the prop in `main.tsx`.**
- [ ] **Step 3: Run both splash specs on both projects.** `npx playwright test tests/splash.spec.ts tests/v2-splash.spec.ts`. Expected: all pass.
- [ ] **Step 4: Commit.** `git commit -m "V2 splash grows into the launch welcome; V1 unchanged"`

### Task 8: Welcome browser specs, Settings switch, visual check

**Files:**
- Create: `tests/v2-welcome.spec.ts`
- Modify: `src/v2/ui/dialogs/SettingsDialog.tsx` (guest-only switch `STRINGS.welcome.showOnLaunch` → `setSkipChosen(!value)`)

Specs (desktop and phone; all use `?v2&splash`, seeding `localStorage` / `sessionStorage` through `page.addInitScript`):
- [ ] **Step 1: Write `tests/v2-welcome.spec.ts`.**
  - Empty storage shows "Welcome to InFlight". Continue as guest → workspace visible, and `inflight.launch.launched` is set.
  - A seeded profile `{signedIn:true,displayName:'Sam',initial:'S'}` plus a seeded last project whose id exists in the sample catalogue → "Welcome back, Sam". The card opens that project (editor visible).
  - A seeded last project with an unknown id → the card leads to the hub, showing "That project is no longer here" (Review Focus 1).
  - `context.setOffline(true)` before load → the welcome renders. Sign in → the Apple, Google and email buttons are disabled, and the offline message is visible (Review Focus 2).
  - While the welcome shows, pressing Tab 15 times keeps `document.activeElement` inside `[data-testid="splash"]`, and pressing `g` doesn't open the grid (Review Focus 5).
  - A seeded guest with `inflight.launch.skip = "1"` → no welcome heading. The workspace appears after the splash fades.
- [ ] **Step 2: Run them to see the switch-related one fail.** `npx playwright test tests/v2-welcome.spec.ts`. Expected: only the Settings-switch expectations fail.
- [ ] **Step 3: Add the Settings switch,** shown only when `readProfile()` is null.
- [ ] **Step 4: Run all splash and welcome specs.** `npx playwright test tests/splash.spec.ts tests/v2-splash.spec.ts tests/v2-welcome.spec.ts`. Expected: pass.
- [ ] **Step 5: Visual check.**
  - `npm run dev`, then open `?v2&splash` in light, dark, Pro light and Pro dark, at 1280×800 and 390×844, and with reduced motion.
  - Compare against mockup version 2.
  - Record anything off, and fix it before the PR.
- [ ] **Step 6: Run the full checks and open the PR.** `npm run lint` and `npm test`, then push and open a draft PR. Its description gives PASS, FAIL or NOT RUN for each check. Apple and Google sign-in against real accounts are NOT RUN in CI: they need manual sign-in.
- [ ] **Step 7: Commit.** `git commit -m "Launch welcome: browser specs and the Settings switch"`

---

## Amendments after the sign-up design (26 Nov 2026)
Approved design: `docs/superpowers/specs/2026-11-26-sign-up-and-plans-design.md`.

- **Task 6, sign-in panel layout.** Apple and Google sit side by side in one row, each with its mark. Apple is black and Google white, following each company's button guidelines. The accessible names are `STRINGS.welcome.withApple` and `withGoogle`. "Continue with email" goes below an "or" divider. When only one provider is available, it fills the row.
- **Task 6, results from Task 3.** Handle every result kind from `src/providers/accountSignIn.ts`:
  - `'signed-in'`: show the outcome line.
  - `'linking'`: show `linkingProblemText(problem)` from `src/components/SignInMethodsPanel.tsx`.
  - `'error'`: show `message`.
  - `'offer-create'`: show the create confirmation.
  - `'created'`: show `STRINGS.welcome.created`.
  - `'wrong-password'`: show `STRINGS.welcome.wrongPassword`.
- **Task 6, plan step.** New accounts land on the signed-in state, as now. The plan chooser, cloud credit and checkout are a later sub-project and are not built here.
- **New Task 9: Welcome back slideshow** (after Task 8).
  - On the signed-in and guest states, a slow crossfade (about 6 s per photo, 1 s fade) through up to 8 flagged photos from the last project.
  - It uses previews already stored on the device and downloads nothing.
  - It is still with reduced motion, has a Settings switch to turn it off, and is hidden when there are no flagged previews.
  - Text over it stays readable (scrim, AA contrast). There's a small caption naming the project.
  - Pure selection logic goes in `src/core/` with unit tests. The spec checks the switch and reduced motion.
