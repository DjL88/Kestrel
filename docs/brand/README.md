# Kestrel brand kit

![Kestrel wordmark](kestrel-lockup.svg)

A right-facing kestrel crosses a split **K**. The copper wing and wine-crimson underside sit
between the dusk-blue and wine diagonals. Flat vector shapes throughout; the swept wing and hooked
beak carry the "bird of prey" read even at 24px.

This is a refresh of the original direction: the concept (kestrel crossing a K) stayed, the
execution moved from bright, saturated "app icon" tones to something deeper and more editorial,
closer to a premium camera or lens brand.

- [App icon and favicon](../../src/assets/kestrel-mark.svg) — the mark on its rounded-square chip. Use from 24px.
- [Full-colour symbol, transparent background](kestrel-symbol.svg) — for anywhere the dark chip doesn't fit.
- [Ink symbol, transparent background](kestrel-symbol-ink.svg) — single-colour silhouette, for contexts that need one flat colour (embossing, single-colour print, watermarks).
- [Lockup (symbol + wordmark), on the dark surface](kestrel-lockup.svg) — use on Projects and in product material.

Leave clear space of at least one quarter of the symbol's width around either lockup. Never
recolour the symbol outside the brand hues below, never add a drop shadow, bevel or gradient to
it, and never stretch it off its square aspect.

## Colour tokens

The source of truth for what actually ships is `src/index.css`'s `--color-kestrel-*` custom
properties — this table documents the same values, not a separate palette. (`kestrel-blue` below
is called "dusk-blue" and `kestrel-red` is called "wine-crimson" in design conversation; the CSS
variable names were kept as-is through the refresh to avoid touching every call site.)

| Token | Value | Role |
| --- | --- | --- |
| Canvas | `#14161B` | Project and application background |
| Stage | `#12141A` | Neutral background around the photograph |
| Panel | `#1A1D23` | Toolbars and editing panels |
| Raised | `#1C2027` | Dialogs, menus and the app icon chip |
| Ink | `#F4EFE6` | Primary text. 14.74:1 on Panel |
| Mist | `#8B93A3` | Secondary text, muted labels. 5.47:1 on Panel, 5.86:1 on Canvas |
| Copper (`kestrel-copper`) | `#C9652E` | Primary interface actions; wing and body in the logo. 4.33:1 on Panel, 4.64:1 on Canvas. Pair with near-black text, not white |
| Copper hover | `#D97840` | Hover/active state for copper actions |
| Dusk-blue (`kestrel-blue`) | `#4A88B2` | Selection, focus, Keep; upper K diagonal in the logo. 4.39:1 on Panel, 4.70:1 on Canvas |
| Wine-crimson (`kestrel-red`) | `#C54F63` | Branding and delete confirmations only, always with an icon and the word "Delete"; lower K diagonal and underside in the logo. 3.76:1 on Panel, 4.03:1 on Canvas |

Contrast is the hard constraint here, not a nice-to-have: dusk-blue and wine-crimson both carry
real UI state (selection, focus, delete confirmation), so an earlier, even-more-muted pass that
fell under 3:1 against the dark surfaces was pulled back up until it cleared roughly 4:1 —
measured with the real WCAG relative-luminance formula, not eyeballed. Wine-crimson still reads
below the 4.5:1 normal-text threshold on its own, which is why it is never used as the *only*
signal for a destructive action — always paired with an icon and the word "Delete" (see
`docs/accessibility.md`).

## Typography

- **Inter** — UI, body copy, tabular figures for values and counters. Chosen for neutrality and
  legibility at small sizes in a photo-editing interface, not for personality.
- **Plus Jakarta Sans**, weight 800, tight tracking (−0.02em to −0.03em) — the wordmark and any
  large display moment: splash screen, about screen, marketing headlines.
- **Atkinson Hyperlegible** — reserved for the app's own accessibility "readable" mode. Not used
  elsewhere.

## Interface treatment

- Flat colour throughout, deliberately — no gradients, bevels or drop shadows on the mark or in
  the chrome. Depth comes from layering flat surfaces (canvas → panel → raised), not from
  lighting effects.
- **Projects and Library** use the same subdued surfaces, with one strong entry action and
  project names given room to breathe.
- **Grid, single-photo and Compare** keep tool chrome around the image rather than adding
  decorative layers over it.
- **Edit and crop** keep the export action prominent and the stage dark.
- **Photo Info, Add photos, Macro pad and Export** share the raised surface. Keep headings and
  actions clear and allow content to scroll on short screens.
- Copper and wine-crimson are the hardest pair to tell apart with red-green colour blindness, so
  state is never carried by that pair alone — Keep/Reject always show an icon and a word, and use
  blue and copper.
