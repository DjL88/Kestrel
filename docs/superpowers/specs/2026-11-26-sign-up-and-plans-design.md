# Sign in, sign up and plans: every scenario (design)

Status: proposed. The owner agreed the flows on the mockups on 26 November 2026; this document needs approval before planning.
Builds on: `2026-11-25-launch-welcome-design.md` (the in-app launch welcome, partly built on `feat/splash-lands-in-header`).
Mockups: `2026-11-26-sign-up-mockups/sign-up-flows.html` (v4, sections A–E) and `welcome-states.html` (welcome states v2).

## Intent
InFlight's front door should be one calm, honest journey, on the web and in the apps:

1. A welcome where you sign in (which also signs you up) or continue as a guest.
2. Home, where your projects and Settings live.
3. The editor.

New accounts choose Basic or Pro, add cloud credit if they want, and pay only when something costs money. On the web, inflight.studio itself becomes that welcome. It replaces the old marketing page, but still explains what InFlight is and offers the downloads. While the owner tests, everything that needs an account is by invitation only.

## Decisions (owner, 25–26 November 2026)
- **Journey:** welcome (sign in or guest) → home (projects and Settings) → editor.
- **Signing in is signing up.** Apple and Google buttons sit side by side with their marks, with email below. For a new email, InFlight asks "Create your account?" before creating it.
- **inflight.studio is the welcome page.** It is a long scroll explaining what InFlight is and how it works, with a showcase (animated visuals later, stills until then). Downloads for Mac, Windows, the App Store and Google Play stay on it, plus an "Older versions" section once older releases exist. Scrolling past the sign-in card moves its buttons into the header.
- **The web is the full app, 100% in the cloud.** Signed-in people get their projects and the editor in the browser, working only on cloud copies of their photos, never local files.
- **Web guests** edit their own photos in the browser. Nothing is kept after the tab closes. Sample projects stay available to try.
- **Plans are data, set in `/admin`.** Each plan has its prices, allowances and included features. Features come from the existing feature switches (`featureAvailable`). The plan chooser, the front page's plan section and every upgrade prompt read the same record, so Basic and Pro can be rebalanced without a release.
- **Basic keeps the whole core workflow, uncapped:** import, cull, edit and export, offline, plus every on-device AI tool (ROADMAP decision 13). There is no import cap. Pro is the affordable step up that adds power and convenience (more cloud, cloud AI and larger checks, the web app's cloud projects, sharing and galleries, and later Pro features). No "rubbish free version", no high entry fee.
- **Pro at launch is a subscription,** annual (£29 today) or monthly. If it lapses: back to Basic, nothing deleted, and anything edited with Pro tools still shows and exports exactly as edited. Only further Pro editing needs Pro.
- **Keep forever and rent-to-own are `/admin` switches, off at launch.** The built licence-key and major-version code stays, used for gifts and admin-granted licences. If keep forever is switched on later, it covers one major version. A new major version (1 → 2) shows as Basic until upgraded, while point releases stay covered. Rent-to-own, if switched on, counts paid months for the version that was current when they were paid.
- **Cloud allowances:** cloud runner 500 photos a month on Basic and 5,000 on Pro. Pro includes 2.5 GB of storage. Everyone gets 1 GB of downloads a month.
- **Cloud is token-driven.** One prepaid balance pays for everything beyond the allowances: extra runner photos, storage above the included amount (charged monthly on what is actually stored), and downloads above 1 GB. Top up by hand, or turn on **automatic top-up: "when my balance falls below X, add Y"**, like AI credit services. Credit rolls over and can be refunded at any time. The credit screen says in plain amounts what a top-up buys.
- **Currencies:** several from the start: GBP, EUR, SEK, NOK, DKK, USD, CAD, AUD and NZD, for the UK, western and northern Europe, the US, Canada, Australia and New Zealand. Other markets are not offered for now. Paddle charges in the buyer's currency. Each sellable item has a Paddle price per currency, chosen in `/admin`. Credit and usage rates are held per currency, and the balance stays in the currency it was bought in. All front-page and sign-up text uses the app's translations.
- **Web paths:** the welcome is `/`, home is `/home` and the editor is `/editor`, with `/Home` and `/Editor` redirecting. The owner-only `/V2Proto` gateway is retired from public use and the invitation gate takes its place.
- **Basic on the web** is a real, accessible version: projects in the cloud are paid from credit, since Basic includes no storage, and the credit screen says so plainly. Guests can still edit in the browser with nothing kept.
- **Payment wording:** "Pay by card", plus Apple Pay or Google Pay where the browser or device offers it. The provider (Paddle) is not named on the button. The iPhone and Android apps use the App Store or Google Play.
- **Welcome back** shows a slow slideshow of the person's own photos, with "Pick up where you left off" and "Go to my projects".
- **No numbers in code.** Every price, allowance, rate, top-up amount and typical photo size comes from fields the owner sets in `/admin`.
- **By invitation only** while testing.

## Principles check (PRODUCT-SPEC and CLAUDE.md)
| Principle | How this design keeps it |
|---|---|
| Originals are never written, moved or replaced | The web works only on cloud copies the person chose to upload. Web guests' edits leave only as exports, new downloaded files. The apps are unchanged. |
| Offline is fully functional, with no account needed for core use | Guests in the installed apps keep everything and work offline. The welcome and its state render offline. Only buying, cloud and the web need a connection, and the screens say so. |
| No uploads, telemetry or accounts by default | Cloud stays opt-in. On the web, using projects means choosing the cloud, and the front page says so before anyone starts. The slideshow uses previews already on the device, or already in their cloud on the web, so nothing extra moves. |
| Never overstate | The Pro feature list is built from the same source as the app's Pro feature flags. Every on-device AI tool is listed under Basic (ROADMAP decision 13). "£5 buys about…" uses the stated typical photo sizes and says "about". The web editor says what it can and can't do with RAWs in a browser. |
| Never silently discard a decision | Web guests are told up front that nothing is kept, and warned before closing a tab with unexported work. Running out of credit pauses cloud work and never deletes. |
| Calm and accessible, no colour-only cues | Basic has equal weight, with no countdowns or pressure. Status is text plus a dot. Motion (header move, slideshow) honours reduced motion and the slideshow can be turned off. Buttons are at least 44 px with visible focus. Apple and Google buttons carry full accessible names. |
| One behaviour on every platform | The screens are the same everywhere. Platform differences live in adapters: how sign-in is stored (web "Keep me signed in"), which wallet appears (Apple Pay, Google Pay), and the purchase route (Paddle, App Store or Google Play). |
| Account, licence, device and encryption keys stay separate (PRODUCT-SPEC :108) | The account identifies the person. The licence or ownership flag grants Pro for a major version. Keys are never used as authentication. |

## Non-goals
- Animated showcase visuals (placeholders until the product is built).
- Native Apple and Google sign-in inside the iPhone and Android apps (not built today; email works there).
- Changing how the existing keep-forever licence key is minted, checked or emailed (already built, with a major version).

## Anti-goals (would count as failure even if it works)
- Any price, allowance or rate shown in one place and charged differently in another.
- A guest in the installed apps being blocked by the invitation gate.
- A web guest losing work without warning.
- Pressure tactics: preselected upsells, hidden "Continue with Basic", fake scarcity.
- Charging or deleting anything when the balance runs out.

## Scenarios (mockup references)
1. **Web, signed out (A):** explainer page with sign-in card (Apple | Google, email, guest), invitation notice, downloads, older versions, footer links. Scrolled: the header carries Continue as guest and Sign in.
2. **Web guest:** the editor in the browser on chosen local photos, ephemeral. Export saves new files. A leave-page warning appears when there is unexported work. Sample projects are offered.
3. **Sign in / sign up (B1, B2):** Apple | Google side by side, email. "Create your account?" for an unknown email. "Keep me signed in" on web only. Account linking from #1645 ("sign in the way you used before") is handled.
4. **Not invited (B3, gate on):** "Not on the invitation list yet". The account is saved, with "Request an invitation" and "Continue as guest".
5. **New account → plan (C1):**
   - Basic, or Pro annual or monthly. Features and prices come from the `/admin` plan record.
   - Keep forever and rent-to-own text appears only when their `/admin` switches are on.
6. **Cloud credit (C2):**
   - Rates with worked "£5 buys about…" examples.
   - Choose "Add credit now" and/or "Top up automatically when my balance falls below X", or skip.
   - "Credit rolls over and can be refunded at any time."
7. **Pay (C3 web and desktop, C4 phones):** a summary, then Pay by card / Apple Pay / Google Pay (Paddle overlay), or the store sheet on phones. Skipped when nothing is due.
8. **Done (C5):** Pro status, plus the "licence key on its way" note for keep forever, then home.
9. **Returning, signed in (D1):** slideshow, "Pick up where you left off", "Go to my projects", "Not you? Sign out".
10. **Returning guest in the apps (welcome-states 3):** as in the launch-welcome design.
11. **New major version:** subscribers simply carry on. Only people holding a keep-forever licence (gifts, admin grants, or keep forever if switched on) see "You own Pro for version 1. Version 2 runs as Basic until you upgrade."
12. **Pro lapses:** a calm notice ("Your Pro has ended. Everything you made is unchanged and still exports"), with "Renew Pro" and "Continue with Basic".

## /admin "Plans and prices" (E)
- **Fields:**
  - Photo allowances per plan, included storage, included downloads.
  - Months to ownership.
  - Per-photo, per-GB storage and per-GB download rates.
  - Plan definitions: per plan, its prices per currency, allowances and included features.
  - Top-up amounts per currency, automatic top-up limits (lowest threshold, amount choices), and whether credit is refundable.
  - Switches for keep forever and rent-to-own (off at launch).
  - Typical RAW and JPEG sizes for the worked examples.
  - For each sellable item, the chosen Paddle price ID (amount and currency read from Paddle, so what is shown is what is charged), and later the App Store and Google Play product IDs.
- **Publishing:** "Review and publish" shows a preview of the affected screens, runs the existing margin check against cloud costs, and records an audit-log entry. Changes apply to new purchases; existing subscriptions are handled by Paddle's renewal rules with notice.
- **Rate and price changes:** `/admin` sets an effective date at least 30 days ahead. New customers get the new values from publishing. Existing customers keep the old ones until the effective date. They are told 30 days ahead by email and app notification (FCM), and through a notice in Settings, then Account. The server's metering (cloud jobs, storage billing, downloads) reads the published values by effective date, not only the apps.
- **Delivery:** the values are served with the public flags and cached by the apps. Offline, the last values are shown with "prices as of [date]". The constants in `src/core/cloudPlan.ts` become a fallback, used only by an install that has never been online.

## Calls settled after the builder check (Claude's, for the owner to check)
- **Front page and web app:** the front page is a fast static page (translated, as the site is today), and its sign-in buttons open the web app. The web app uses the same sign-in code as the installed apps, so sign-in exists in one place.
- **Invitation gate:**
  - It blocks new sign-ups and the web and cloud features.
  - Existing accounts, paying customers and licences granted from `/admin` always get through.
  - Invitations are an `/admin` list, and "Request an invitation" adds to an `/admin` queue.
  - Guests in the installed apps are never blocked.
- **Credit refunds:** the unused balance is refunded from the most recent top-ups first, within Paddle's refund window. Older amounts are refunded by the owner from `/admin`. Automatic top-up charges a saved payment method through Paddle; the mechanism is confirmed while building.

## Approaches considered
- **One big project:** too large to review, and it mixes web hosting, payments and store work.
- **Split into ordered sub-projects (chosen).** Each lands on its own and is reviewable:
  1. **Launch welcome in the apps.** Finish Tasks 6–8 of the existing plan, plus the slideshow and the Apple | Google button layout.
  2. **Plans and prices in /admin**, served publicly, and the apps reading them instead of constants. Everything after depends on it.
  3. **inflight.studio front page:** the explainer, sign-in card, header move, downloads and older versions, replacing `site/index.html`. Legal pages are unchanged.
  4. **Invitation gate:** an `/admin` switch and invitation list, checked by the control plane at sign-in for web and cloud features, plus the B3 screen and "Request an invitation".
  5. **Plan and payment:** plan chooser, cloud credit and checkout.
     - Paddle subscriptions (monthly and annual), with keep forever and rent-to-own behind `/admin` switches.
     - Automatic top-up below a threshold, and credit refunds.
     - Today's settlement rejects subscriptions, so this is new backend work.
  6. **Web app on cloud projects**, and the ephemeral web guest editor.
  7. **App Store and Google Play purchases**, with server-side verification linked to the account.

## Open items (to confirm while building, not blocking approval)
- How Paddle charges a saved payment method for "when below X, add Y", and which payment methods it offers in each currency.
- Whether cloud credit can be sold inside the iPhone and Android apps under store rules. Until confirmed, credit is bought on the web or desktop and used everywhere.
- Which features move to Pro as they are built. The packaging lives in `/admin`, so this can change after launch without a release.
- ROADMAP decision 14 (web as viewer and exporter) is superseded by the owner's decision that the web is the full app on cloud projects. The lead session records this in the ROADMAP; this design does not edit it.
- The stale ROADMAP section "Accounts, licences, payments" (one-off only, SumUp) needs the lead's update.

## Checks (per sub-project; the details go in each plan)
- **Unit tests:** pricing maths (worked examples, ownership after N months), reading values from `/admin` config with offline fallback, and the gate decision.
- **Browser specs, desktop and phone:** front page (sign-in card, header move, downloads, reduced motion), not-invited screen, plan → credit → summary skip when nothing is due, web guest leave-page warning.
- **Manual:** Paddle sandbox (card, Apple Pay, Google Pay), subscription renewals and the ownership flag, App Store and Play sandbox purchases.
