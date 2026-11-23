# InFlight release UAT: account flags, iPhone/iPad, Android tablets and foldables

Sprint: [#1059](https://github.com/DjL88/Kestrel/issues/1059). These checks are release requirements, **not evidence of passing tests**. All test accounts and domains must be owned or explicitly authorised by the tester. Local photos must remain accessible regardless of feature grants.

## A. Feature flags: priority and deny rules

The intended rule priority for an ordinary Pro-gated feature is:

1. **Never-gated safety functions** (local originals, project recovery, basic editing and local export) cannot be disabled by a commercial flag. A centrally approved emergency kill switch must be assessed for *gated* features.
2. **Exact authenticated user** override (specific email/account).
3. **Verified email domain** rule, written as `*@company.example` (a whole email domain, never a loose substring or regex).
4. **Verified organisation or Enterprise account** override.
5. **Signed subscription or plan** (Basic, Pro, Pro Cloud).
6. **Public/default** flag when no higher-priority rule applies.

An explicit **OFF beats ON at the same priority**. A named Enterprise/Pro user denied a feature must remain denied even if their plan would normally include it. A named Basic user allowed a Pro editing feature gains only that named *local* feature; this does not automatically confer cloud upload, quota, storage, models, purchases or billing rights. Cloud APIs must independently check trusted identity, paid-through, quota and consent.

### Current implementation versus missing work

- Source `src/core/featureFlags.ts` already supports named user, organisation, plan and everyone, with user > organisation > plan > everyone and OFF winning ties. `services/control-plane/src/app.ts` hashes exact emails and signs per-person resolved flags; existing admin Flag UI can edit them.
- **Domain wildcard targeting is not implemented.** A SHA-256 hash of the full email cannot be used to determine its domain. Backend W5 must implement verified-domain identity and server-side rule resolution, and UI W4 must add the admin audience option. A keyed HMAC of a domain (not a plain reusable hash) is preferable because domains have a small guessable space; maintain key rotation/versioning. Avoid treating a user-entered email or client-side flag as verification.
- Accept/display `*@company.example`; reject ambiguous `*company.example`, `*@company.example.evil`, `*.` and generic wildcards. Default to exact domain only; subdomains require a separate explicit rule. Normalise case and IDN consistently with authenticated identity.
- On changed verified email, logout or switching accounts, remove stale grants and refresh the per-account resolved flags. Signed offline grants must respect expiry and revoked rules on reconnection; never put a raw user or private domain rule in a public signed flag document.

### Gate table

| Test identity | Plan | Matching rules | Expected |
|---|---|---|---|
| alice@company.example | Basic | Pro plan ON only | OFF |
| alice@company.example | Basic | Exact user ON, Basic OFF | ON for that named local feature |
| alice@company.example | Pro | Exact user OFF, Pro ON | **OFF** |
| alice@company.example | Enterprise | Exact user OFF, organisation ON | **OFF** |
| bob@company.example | Pro | Domain OFF, Pro ON | **OFF** |
| alice@company.example | Pro | Exact user ON, domain OFF | ON if not globally killed |
| bob@company.example | Basic | Domain ON, Basic OFF | ON for that named local feature |
| bob@evilcompany.example | Pro | Domain company.example OFF, Pro ON | ON (no false domain match) |
| bob@company.example.evil | Pro | Domain company.example ON, Pro OFF | OFF (no false domain match) |
| user@sub.company.example | Pro | Domain company.example OFF, Pro ON | ON by default (subdomain not included) |
| Unauthenticated | Basic | Exact user ON | OFF (no identity match) |
| Signed-out previous Pro | Basic | Prior cached exact user ON | OFF (no cross-account leakage) |

Also check duplicate rules OFF/ON tie (OFF), expired trials, app min-version, emergency kill, 0/100% rollout, clock skew/offline, administrator 403, forged email and signed-grant tampering, and server denial even where the UI mistakenly shows access. Never-gated local functions must remain available after any denial or downgrade. Track each case as PASS, FAIL or NOT RUN with exact app/backend commit.

## B. Form-factor matrix

Automated **viewport approximations** can use:
```bash
npm run test:e2e:dev -- --grep "adaptive form factor"
```
The new `tests/verified-asset-v2-adaptive.spec.ts` visits a V2 sample shoot, selects a photograph, then changes viewport size *without reloading*, checks selection persistence, visible canvas and small-screen navigation, and captures 390/820/1080px reference screenshots. It also verifies the mobile More menu is reachable. It runs under both the desktop and phone Chromium projects.

| Profile | CSS viewport | Required check |
|---|---|---|
| Compact phone | 320 × 720 | Toolbar, canvas, accessible 44px targets, no clipped actions |
| iPhone / Android phone | 390 × 844, 430 × 932 | Portrait, import/cull/edit, mobile drawer and safe insets |
| Folded / narrow Duo pane | 540 × 720 | Single-pane navigation and filmstrip |
| Small Android tablet | 600 × 900 | Portrait filmstrip and editing panel |
| Narrow unfolded/landscape | 720 × 540 | Landscape safe-area and crop handles |
| iPad mini portrait | 744 × 1133 | Browser breakpoint and toolbar visibility |
| iPad portrait | 820 × 1180 | Tablet two-pane editing and stylus |
| iPad landscape | 1024 × 768 | Filmstrip and sidebar docks, drag/drop |
| Unfolded foldable | 1080 × 720 | Resize without losing photo/edit/crop state |
| Larger tablet landscape | 1180 × 820 | Tablet parity with desktop |
| Desktop | 1280 × 800 | Docking, keyboard and export |

### Actual physical hinge and OS test (not covered by viewport resizing)

- **Android Studio**: use Resizable Emulator and a foldable device profile. Exercise **closed outer screen → open inner screen → half-open tabletop posture → rotation → close again** in the same editing session, including background/resume. Check Jetpack WindowManager / folding features for the native wrapper. Verify exported pixels and an editable project after each change.
- **Microsoft Edge DevTools**: emulate Surface Duo dual-screen / segment posture; ensure crop grips, photo content, floating panel, export and touch targets never sit under a noninteractive hinge; test both spanned and single-screen layouts.
- **iOS Simulator**: run **iPhone** portrait/landscape and **iPad** portrait/landscape with actual WebKit or native wrapper, not only Chromium touch emulation. Apple Pencil / finger and external keyboard cases require the relevant device or simulator support.
- **Android tablet / fold hardware when available**: verify real finger/stylus behaviour, drag, gesture cancellation, split-screen multiwindow, app resume, DPI/font scale, 200% accessibility text, colour-blind cues and orientation state restoration.

**Acceptance:** Selection, crop, pan/flip/rotate, unsaved edits, undo/redo and running task queue survive fold/resize without a new import or wrong active photograph. No export button, slider, crop handle, mask action or drawer close is unreachable, and the app does not zoom a RAW preview as though it were full sensor pixels. Capture screenshot/video, browser logs, exact OS and build SHA. A passing 1080px Chromium viewport does **not** certify Duo hinge support, iPad WebKit, or native Android posture.

### References
- Playwright: https://playwright.dev/docs/emulation
- Android adaptive/resizable emulator: https://developer.android.com/develop/adaptive-apps/guides/get-started-with-adaptive-apps
- Android foldable/WindowManager: https://developer.android.com/codelabs/android-window-manager-dual-screen-foldables
- Microsoft Edge Duo emulation: https://learn.microsoft.com/en-us/microsoft-edge/devtools/device-mode/dual-screen-and-foldables
