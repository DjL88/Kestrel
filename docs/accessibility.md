# Accessibility notes

Measured with the real WCAG relative-luminance formula on the two dark surfaces the tokens
actually sit on, `--color-kestrel-panel` (`#1A1D23`) and `--color-kestrel-canvas` (`#14161B`) in
`src/index.css`. (Brand refresh: these superseded the brighter "app icon" palette documented
previously in `docs/brand/README.md` — see that file for the current logo/colour kit.)

| Token | Hex | Contrast on Panel | Contrast on Canvas | Use |
| --- | --- | --- | --- | --- |
| Copper | `#C9652E` | 4.33:1 | 4.64:1 | Primary actions. Text on it is near-black, `text-zinc-950` (5.10:1). White on copper is only 3.9:1, so never use it. |
| Dusk blue | `#4A88B2` | 4.39:1 | 4.70:1 | Selection, focus, Keep. |
| Mist | `#8B93A3` | 5.47:1 | 5.86:1 | Secondary text and borders. |
| Wine crimson | `#C54F63` | 3.76:1 | 4.03:1 | Branding and delete confirmations only, always with an icon and the word "Delete" — it reads below the 4.5:1 normal-text threshold on its own, so it is never the only signal. |

Copper and wine-crimson are the hardest pair to tell apart with red-green colour blindness, so
state is never carried by that pair. Keep and Reject always show an icon and a word, and use blue
and copper.

## Display settings (Workspace options, Layout)
Dark, Night, High contrast; text size 100/125/150%; Plus Jakarta Sans or Atkinson Hyperlegible; Reduced stimulation (no animation). Everything is stored on the device. Fonts are bundled for offline use (Latin subsets only).

## Not yet verified
Screen-reader pass, keyboard-only pass on the new Tone section, High contrast theme on every screen, touch layouts on a real phone.
