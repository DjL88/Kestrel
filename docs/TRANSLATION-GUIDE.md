# InFlight translation guide

The brief for anyone (person or AI worker) who writes or reviews InFlight's words in any language. Owner decision, 25 November 2026: **understanding comes before literal accuracy.** A beginner who has never used Lightroom, and people with dyslexia, ADHD or autism, should know what a control does from its label.

British English (`src/i18n/**/source.ts`, `src/i18n/en-GB.ts`, the `en-GB` block of `site/assets/i18n-strings.js`) is the source. Fix unclear English first; a muddled source is copied into 14 languages.

## Checklist for every string

1. Use common, everyday words. Avoid slang, idioms, regional expressions and needlessly formal or bureaucratic wording.
2. Use the fewest words that keep the meaning. Short labels; explanations go in a separate hint or tooltip.
3. Read the control in the app first and translate what it **does**, not the English words.
4. Use the established photographic term where one exists (see the glossary), and the same term for the same feature everywhere: app, website, help and tutorials.
5. Never imply AI certainty. "High confidence" is confidence, not "certain" or "sure". Keep "probably", "may" and "check it" hedges.
6. Make destructive actions unmistakable. Keep, Reject, Trash and permanent Delete are four different things; Undo and Reset are different; colour correction and colour grading are different.
7. Handle singular and plural properly (use `plural()` from `src/core/locale.ts`).
8. Keep `{placeholders}`, `${…}`, `<strong>`/`<em>`, keyboard shortcuts, units and file formats exactly.
9. Keep buttons short enough for a phone screen.
10. Keep one register per language. Informal "you" is fine for consumer software; in short labels, avoid pronouns altogether.
11. Fill a missing string rather than leaving it to fall back to English.
12. Prefer meaningful fixes over cosmetic ones (straight versus curly apostrophes can wait).
13. If you are unsure, say so and flag it for a native speaker. Never claim a translation is checked when it isn't.

Welsh, Scottish Gaelic, Irish and Icelandic need a native speaker's review before release: AI review is weakest there.

## Glossary

| English term | Rule |
| --- | --- |
| Best picks (was Keepers) | The photos you chose to keep. Not "selected": selected means ticked in the grid. |
| Auto pick (was Auto-cull) | The task that suggests best picks. Never imply it deletes anything. |
| To review (was Undecided) | Photos with no decision yet. |
| Reject | Set aside. Not delete. |
| Trash | Removed from the project; the original file is never deleted. |
| Delete | Only for something permanent; say what is deleted. |
| Undo / Redo | One step back or forward. Different from Reset. |
| Reset / Clear | Back to the starting state. Say what is reset ("Reset to original"). |
| Photo style (was Look) | A saved set of adjustments you can apply. |
| Photo strip (was filmstrip) | The row of photos along the bottom. |
| Exposure, Highlights, Shadows, White balance, Saturation | Keep the standard photographic term in each language. |
| Vibrance | Keep it distinct from Saturation. |
| Mask | Keep. |
| Feather | The local term for a soft edge. |
| Denoise | The local term for noise reduction. |
| Crop | The normal local photo-cropping term (never a farming "crop"). |
| Clipping | Explain as lost detail in bright or dark areas where space allows. |
| Demosaicing | Advanced controls only; explain it in help. |
| Colour grading | The established photographic term; not the same as colour correction. |
| Preset | The familiar local photographic term. |
| Subject detection | Describe it as finding the main subject. |
| Sidecar (XMP) | Say "XMP file" where the file is XMP. |
| High confidence / Low confidence | Confidence level, never certainty. |
| RAW, JPEG, TIFF, XMP, DNG | Never translate. |
| InFlight, Co-pilot, Auto-pilot, Solo, Pro, Basic | Brand and feature names: keep as written. |

## Language choices settled on 25 November 2026

| Language | Term | Use |
| --- | --- | --- |
| German | Sidecar files | XMP-Dateien |
| Italian | Reset edit (all edits) | Ripristina originale |
| French | Filmstrip | Bande de photos |
| French | Reduce movement on screen | Réduire les animations |
| Welsh | Burst | Cyfres o luniau |
| Irish | Burst | Sraith grianghraf |
| Dutch | Photo styles (Curated Looks) | Fotostijlen |
| Spanish | High confidence | Confianza alta |
| Portuguese | Colour grading | Gradação de cor |

## Where the review lives

The 25 November AI review (every string in all 14 languages, with confidence) is `translations/translation-review-2026-11-25.xlsx` in the InFlight project files. Use it as a backlog, never as a list to accept in bulk.
