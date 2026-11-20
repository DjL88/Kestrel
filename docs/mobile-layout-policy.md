# Mobile and tablet layout policy

Kestrel uses **one responsive editor** for its web shell and future iOS / Android app shells. Device brand, model string, iOS/Android user agent and screen diagonal do **not** decide the workspace layout.

## Workspace rules

- **Compact, portrait-first editing** when the available CSS viewport is below 800 × 550, or below 840 × 440 in a short landscape window. This includes small phones rotated to landscape, most folded devices, narrow split-screen windows and tablets with an obstructed or short viewport. Editing tools stay in the folding sheet below the image.
- **Wide workspace** from 800 × 550 CSS pixels, or 840 × 440–549 CSS pixels for short landscape tablets (both dimensions required). A landscape tablet can show the same left/right tools panel as desktop, even with touch input. Targets stay at least 44 CSS pixels on touch hardware; do not equate desktop layout with mouse-only controls.
- **Handedness** is a saved device preference. Library → More → Appearance & layout and Edit → settings use the same Left/Right value. On a compact phone the control is saved for a wider window; tools remain below the image rather than covering it.
- The **app/document stays inside the usable viewport**. Use dynamic viewport units and safe area padding, constrain flex children, and scroll long toolbars **within the toolbar**, not the body. Content panels may scroll vertically inside the bounded application.
- Display theme, text size, readable typeface and calm mode are separate accessibility preferences. Text enlargement must not force the document beyond the device width.

## Orientation and fullscreen

The normal small-screen interface is **portrait-first in its arrangement**, not a forced OS portrait lock. Rotating a phone will retain a compact tool layout where there is insufficient space, and must not cut off controls.

In supported browsers, a user may open fullscreen and explicitly request landscape orientation. The app must not auto-lock or auto-rotate in the normal editor. On leaving fullscreen it returns to OS-managed orientation. The browser Screen Orientation lock API is not reliably supported in Safari/iOS, and some browsers deny requests even when the API exists. Never promise platform-wide rotation on the basis of a web capability check.

For future native app wrappers: choose OS-native orientation policies rather than depending on browser Screen Orientation API. Prefer portrait for phone editing, permit user-requested landscape photo viewing, and leave tablets/large unfolded screens free to use landscape. Verify split-screen/multiwindow, fold/unfold, screen-reader and large-text behaviour independently on iOS and Android.

## Acceptance viewport matrix

| Scenario | CSS viewport | Expected editor |
| --- | --- | --- |
| Small phone portrait | 320 × 568 | Compact |
| Typical phone portrait | 390 × 844 | Compact |
| Phone rotated | 667 × 375 | Compact, no clipped controls |
| Foldable narrow/short window | 768 × 700 | Compact |
| Foldable unfolded / landscape tablet | 850 × 700 | Wide, desktop-parity editor tools |
| Tablet landscape | 1024 × 768 | Wide left/right panel |
| Large tablet / desktop | 1280 × 800 | Wide |

Run `tests/mobile-viewport.spec.ts` in the Playwright phone project. Also confirm real-device browser chrome/safe areas, on-screen keyboard, virtual keyboard focus and OS orientation permissions before shipping a native wrapper.

## Foldable and iPhone Duo acceptance (20 November 2026)

Apple's iPhone Duo is an actual 2026 foldable device; support the narrow cover display, unfolded landscape workspace and transitions without relying on model strings. The browser may or may not expose viewport-segment/device-posture APIs. Prefer **usable viewport geometry** as the fallback and use segment CSS features only when supported. A spanning two-segment display must not place the most important interactive control inside a hinge.

- Narrow external/flip-cover displays (roughly 320–420 CSS px): essential photo, cull/review actions and icon-first editor tabs; descriptions remain as accessible names and full text lives inside the opened tool sheet. Hide redundant status badges in the action bar instead of squeezing text.
- Narrow or short unfolded/split-window views: compact photo-first view and individually scrollable tool sheet; do not infer desktop from touch or diagonal size.
- Unfolded wide displays at **800 × 550+** usable CSS pixels (or 840 × 440–549 in landscape): same docked editing layout and photo tools as desktop. Landscape tablets should not lose functionality, but keep touch-friendly targets.
- For a dual-viewport physical hinge, keep the image and active controls out of the hinge; guard with `horizontal-viewport-segments` when exposed and fall back to the standard responsive flow when absent. Never rely solely on `device-posture` because support differs by browser.
- Keep Photo Info on its **separate, more conservative two-dimensional threshold** (1024 × 550 or 1280 × 440): a two-panel editor needs more breathing room before the third Info panel docks. Never use a width-only rule that crowds the photo.
- Fold/unfold while importing, culling and editing must preserve selection, original-file links, active recipe, and pending Task Manager operations. Avoid remounting state simply to switch layout.

**Evidence gate:** Playwright at 320×568, 375×812, 390×844, 667×375, 850×700, 1024×768, 1180×820, 1280×800. Repeat with 125/150% text, on-screen keyboard, portrait-to-landscape, touch and reduced motion. Native device QA on iPhone Duo (cover/unfolded), a Samsung Fold, a flip-cover phone and iPad landscape remains **NOT RUN** until actually measured. Don't mark native parity complete from CSS or emulation alone.
