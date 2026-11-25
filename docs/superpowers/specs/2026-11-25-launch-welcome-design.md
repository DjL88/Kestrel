# Launch welcome: the splash grows into a welcome screen (design)

Status: proposed, awaiting owner approval. Builds on PR #1637 (wing-joint fix). Mockups: version 2 of the welcome mockups shown to the owner on 25 November 2026 (screens 1–4 and a desktop view).

## Intent
Today the launch splash plays, fades, and drops the person onto the projects list. The owner wants launching InFlight to feel like one continuous welcome: the animated logo stays, and a welcome screen grows out of it. On that screen someone signs in (which also creates their account if they are new) or continues as a guest. Someone already signed in is greeted by name and chooses where to go. Nobody is ever signed out by this.

## Goals
- After the launch animation, the animated logo stays and rises a little. The welcome content fades in beneath it on the same layer, so there is no cut between splash and welcome.
- Three states, chosen locally and instantly (no network, no sign-in code loaded at start-up):
  1. **First launch:** "Welcome to InFlight". Continue as guest (primary), Sign in (secondary), and "No account needed. Works fully offline."
  2. **Signed in:** avatar initial, "Welcome back, <name>", and Pro status as text plus a dot. "Pick up where you left off" (a card for the last project, highlighted) and "Go to my projects". "Not you? Sign out" as a link. Nothing happens until they tap.
  3. **Returning guest:** "Welcome back", a line on what signing in gives (backup and Pro on this device), the last-project card, Continue as guest, Sign in, and a "Go straight to my projects next time" tick box.
- **Sign in is also sign up.** One panel offers Continue with Apple, Continue with Google and Continue with email, wherever each is available on that platform. For a new person, signing in creates the account.
- **Web only:** a "Keep me signed in on this browser" tick box on the email form. Ticked keeps the sign-in after the browser closes, unticked forgets it. Installed apps always keep it.
- Signed-out returning visitors on the web land on state 3, the same as the app.

## Non-goals
- No change to the brand-pack Lottie files. The animation is unchanged; only its container moves.
- No change to the older V1 interface. The welcome is for V2, the default interface. V1 keeps today's splash.
- No new Apple or Google sign-in for the iPhone and Android apps. Those buttons appear only where sign-in already works (web, and desktop builds configured for them). Building native mobile Apple and Google sign-in is separate work.
- No change to Pro licensing, backup or the account settings page, beyond sharing their sign-in code.

## Anti-goals (would count as failure even if it works)
- Any start-up wait for the network or Firebase. The welcome must render instantly and fully offline.
- Signing anyone out, or asking a signed-in person to sign in again.
- Making guest use feel second-class. Guest stays a first-class path and core use never needs an account (product spec).
- An account created by accident from a mistyped email.
- Colour-only cues, missing keyboard access, or motion for people who asked for less.

## Approach (chosen: B, the welcome grows out of the splash)
Alternatives considered:
- **A. A separate welcome screen placed exactly under the splash.** Simpler to keep correct, and almost as seamless, but there is a handoff.
- **B. The welcome grows out of the splash (chosen by the owner).** The animated logo never leaves, so it is the most seamless. Costs: the welcome is tied to the splash layer, and a still version is needed for reduced motion.
- An earlier idea, folding the splash back into a chevron in the header, was dropped when the home screen became the welcome.

## Design
### When it shows
- Once per app launch, like the splash today: the existing per-session rule (`shouldShowSplash`, session key) decides. A reload in the same session goes straight to where the person was. Automated runs skip both, so tests are unaffected. `?splash` still forces it.
- If a returning guest ticked "Go straight to my projects next time", the launch plays today's splash and fades to the projects list. A Settings switch ("Show the welcome screen on launch") turns it back on. Signed-in people always see the welcome.

### The launch layer (`src/components/Splash.tsx` becomes the launch layer for V2)
- Phases: `animating` → `welcome` → `leaving`.
- **animating:** as today. A tap or key no longer dismisses everything. It jumps the animation to its last frame and goes straight to `welcome`.
- **welcome:** the Lottie container (still holding the last frame) eases up and shrinks slightly, about 0.4 s, so the stacked logo sits near the top as in the mockups. The welcome content fades in beneath it. The layer stops being `aria-hidden`: it becomes the page's main region with a heading, and focus moves to the primary action.
- **leaving:** the chosen action runs (open the last project, open the projects list, or continue as guest). Then the layer fades out over today's 300 ms.
- **Reduced motion:** no animation. The still stacked logo, already in its top position, with the welcome content shown at once.
- V1 keeps today's splash behaviour unchanged.

### Knowing who is signed in, offline and instantly
- A small local record, `launchProfile`, saved when sign-in succeeds and cleared on sign-out: `{ signedIn, displayName, initial }`. It is written by the existing sign-in paths (settings and welcome) and read synchronously at launch. The display name is the account's name, or else the part of the email before the "@".
- Pro status comes from the existing licence store (`useIsPro`), which already works offline from the signed entitlement.
- If the record says signed in but the real session has gone (expired or revoked), the welcome still greets them. The existing account code notices later and explains, exactly as it does today. The welcome never forces a check.

### Last project
- The V2 store remembers the id of the project last opened, saved locally when a project opens. The card shows that project's name, photo count and when it was last edited. If it's missing or deleted, it falls back to the most recently edited project, and with no projects the card is hidden.

### Sign in, which is also sign up
- Tapping Sign in swaps the welcome buttons for a sign-in panel on the same layer, with a Back action. Firebase loads only now, never at start-up.
- Buttons, each only where available (`signInPlatform()` plus the existing configuration checks): Continue with Apple, Continue with Google, Continue with email. Apple and Google already create the account on first use.
- **Email:** one form with email and password, plus Keep me signed in on web only. The steps:
  1. Try to sign in.
  2. If it fails because the credentials are wrong or unknown, ask: "No InFlight account for sam@example.com yet, or the password is wrong. Create a new account with this email?" with Create account and Try again.
  3. Create account uses the existing `createAccount` (which sends the verification email). If the email is already in use, say the password was wrong and offer the existing password reset.
- Offline: the sign-in buttons are disabled with "Sign in needs a connection. You can continue as a guest and sign in later from Settings."
- On success: save `launchProfile`, then move to the signed-in state's choices. The person still taps where to go.
- **Keep me signed in (web):** ticked uses today's local persistence (IndexedDB). Unticked uses Firebase session persistence. Set on the same Firebase instance before sign-in. Installed apps ignore it.
- The sign-in code shared with `AccountAndLicenceSettings` is pulled into one hook or module, so the two places can't drift.

### Copy and accessibility
- British English, through the existing V2 strings. Every action is a real button with a visible label, at least 44 px tall. Pro and status use text, never colour alone. Focus is visible. Escape on the sign-in panel goes back.

## Settled after review (Claude's calls, for the owner to check)
1. **People already signed in when this ships.** They have no `launchProfile` yet. At launch, if there is no profile but the licence store (read synchronously) records an account standing, they get the signed-in state without a name: "Welcome back", initial hidden. The stored grant does not hold the email or name; this was checked in `src/core/licenceOnline.ts`. If neither exists, they see the guest state once. The first time any sign-in code runs afterwards (Settings, backup and so on), the profile is written, so they are never asked to sign in again. The welcome itself never loads Firebase at start-up.
2. **Keep me signed in, unticked (web).** The profile goes into `sessionStorage`, so a shared computer never greets the previous person after the browser closes. The box sits above all three sign-in buttons on web, because `setPersistence` applies to Apple and Google pop-ups too. Settings sign-in keeps its current always-remember behaviour.
3. **Licence link.** Signing in from the welcome runs the same `linkLicence()` as Settings, via the shared hook. Its outcome is shown as one calm line under the greeting: Pro confirmed, Basic, device limit reached (with "Manage devices in Settings"), or "Check your email to verify your account, then Pro turns on". Nothing blocks the person's choice of where to go.
4. **Last-project card is instant.** When a project opens, a small local snapshot is saved: id, name, photo count, last edited. The card reads it, so it never waits for the catalogue to load. If the project has since been deleted, opening it falls back to the projects list with a short notice. With no snapshot the card is hidden, and the primary action is "Go to my projects".
5. **First launch or returning guest.** A local "has launched" flag, set when the welcome is first left. Anyone with existing projects or that flag counts as returning, so people upgrading see "Welcome back". "Erase device data" clears the flag, so the next launch is a first launch.
6. **Go straight to my projects next time.** That launch plays today's splash unchanged (animation, hold, fade) and lands on the projects list: the brand moment stays, and only the welcome is skipped. The switch to turn the welcome back on lives in V2 Settings, and only shows to guests.
7. **Not you? Sign out.** It does exactly what Settings sign-out does today, including how Pro is treated afterwards, through the same code. Firebase sign-out clears its local state without a network, so it also works offline. They land on the returning-guest state.

## Checks
- Unit (`src/core`): the state chooser (first launch, signed in, returning guest, skip-next-time) and the email sign-in-or-create decision, with no browser.
- Browser (desktop and phone):
  - `?splash` with an empty profile shows first launch, and Continue as guest reaches the projects list.
  - A seeded signed-in profile shows "Welcome back" and the last project card, and the card opens that project.
  - Reduced motion shows the welcome without animation.
  - Automated runs still skip it (existing specs).
  - Offline disables sign-in with the message.
- Manual: Apple and Google on the web against the existing Firebase project, and email create-and-verify. Not run in CI: they need real accounts.

## Left to the builder
- Easing curves and exact sizes, within the mockups.
- The code structure of the launch layer, as long as V1 keeps today's behaviour.
- Exact wording of the error and offline messages, kept plain and calm.
