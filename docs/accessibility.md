# Accessibility notes

Measured with WCAG relative luminance on the dark surfaces `#1B1D24` and `#0D0E12`.

| Token | Hex | Contrast on `#1B1D24` | Use |
| --- | --- | --- | --- |
| Kestrel Orange | `#FF6B35` | 5.9:1 | Primary actions. Text on it is near-black (6.8:1). White on orange is only 2.8:1, so never use it. |
| Sky Blue | `#4EA8DE` | 6.4:1 | Selection, focus, Keep. |
| Highland Mist | `#94A3B8` | 6.6:1 | Secondary text and borders. |
| Ember Red | `#E03A3E` | 3.9:1 | Branding and delete confirmations only, always with an icon and the word "Delete". |

Orange and red are the hardest pair to tell apart with red-green colour blindness, so state is never carried by that pair. Keep and Reject always show an icon and a word, and use blue and orange.

## Display settings (Workspace options, Layout)
Dark, Night, High contrast; text size 100/125/150%; Plus Jakarta Sans or Atkinson Hyperlegible; Reduced stimulation (no animation). Everything is stored on the device. Fonts are bundled for offline use (Latin subsets only).

## Not yet verified
Screen-reader pass, keyboard-only pass on the new Tone section, High contrast theme on every screen, touch layouts on a real phone.
