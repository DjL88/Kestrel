# Mobile and tablet layout policy

Kestrel uses **one responsive editor** for its web shell and future iOS / Android app shells. Device brand, model string, iOS/Android user agent and screen diagonal do **not** decide the workspace layout.

## Workspace rules

- **Compact, portrait-first editing** when available CSS viewport width is below 900px **or** height below 550px. This includes small phones rotated to landscape, most folded devices, narrow split-screen windows and tablets with an obstructed or short viewport. Editing tools stay in the folding sheet below the image.
- **Wide workspace** from 900×550 CSS pixels (both dimensions required). A landscape tablet can show the same left/right tools panel as desktop, even with touch input. Targets stay at least 44 CSS pixels on touch hardware; do not equate desktop layout with mouse-only controls.
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
| Foldable narrow/unfolded small window | 850 × 700 | Compact |
| Tablet landscape | 1024 × 768 | Wide left/right panel |
| Large tablet / desktop | 1280 × 800 | Wide |

Run `tests/mobile-viewport.spec.ts` in the Playwright phone project. Also confirm real-device browser chrome/safe areas, on-screen keyboard, virtual keyboard focus and OS orientation permissions before shipping a native wrapper.
