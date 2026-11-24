# Editing knowledge: checked sources and exposure recovery

Companion to [photography-knowledge-engine.md](photography-knowledge-engine.md). Code: `src/core/photographyKnowledge.ts` (rules) and `src/core/photographyKnowledgeSources.ts` (checked sources and per-rule citations, tested in `photographyKnowledgeSources.test.ts`).

**Status: draft guidance, not calibrated.** Every citation below was read on 24 November 2026 and is paraphrased in our own words. No source text, image or preset is copied into Kestrel. A rule without a checked citation is house practice and must not be presented as sourced.

## What the library is for

The library tells Auto and the Photo Advisor **which direction** to edit and **what to protect** for a subject or lighting state. It never sets fixed slider values from a label: Auto still measures the actual preview, builds a bounded recipe and runs it through the existing gates, so one rule can produce different numbers on different photos. Source figures (EV values and so on) are recorded here as context, never as engine values.

## Exposure recovery: recommended order

Agreed across darktable, RawTherapee, GIMP, Adobe and the bird-photography sources.

1. **Lens corrections first.** Vignetting correction changes overall brightness (darktable workflow).
2. **Set mid-tone brightness with exposure.** A modest positive raw lift is normal, because cameras hold exposure back to protect highlights (RawPedia Exposure).
3. **Compress the range, then shape it.** On high-contrast frames, compress highlights and shadows globally first, then use local shadow and highlight tools gently (RawPedia Shadows/Highlights, darktable filmic).
4. **Recover highlights from what is there.** Pull near-white tones down only until they hold detail; going further turns whites grey (RawPedia). Fully clipped pixels are unknown and stay lost (darktable highlight reconstruction, Audubon, BirdGuides).
5. **Fix colour in clipped areas from unclipped data.** Partly clipped channels produce false colour, often magenta, and white balance pushes it further. Rebuild from unclipped channels or close neighbours in small areas only (darktable highlight and colour reconstruction, RawPedia).
6. **Work locally by brightness zone with edge-aware masks.** This keeps local contrast better than global sliders and avoids halos; plain blurred masks cause halos (darktable tone equalizer, GIMP tutorial).
7. **Reduce noise before sharpening.** Later contrast and sharpening steps make remaining noise more visible. Sharpen strong edges only and judge at full size (darktable workflow, Adobe).
8. **Keep the scene's tonal order.** A sky that was brighter than the land stays brighter (Cambridge in Colour). Misty, low-contrast scenes need not fill the histogram (RawPedia).
9. **Never add or remove content to hide a problem.** No cloning or painting in highlights, no generative fill, no AI upscaling for authentic work (World Press Photo, NHM Wildlife Photographer of the Year, Audubon).

## New rules in v1.1.0-draft

| Rule | Direction | Sources |
| --- | --- | --- |
| `lighting.clipped-highlights` | Bring near-white down only until it holds detail; borrow colour only from close unclipped neighbours; never clone or paint | RawPedia, darktable ×2, World Press Photo, NHM |
| `lighting.clipped-colour-channel` | Expect a hue shift where one channel clipped; rebuild before warming or cooling | darktable, RawPedia |
| `lighting.underexposed-raw` | Modest lift is normal; on big lifts denoise before sharpening and stop before grey, blotchy shadows | RawPedia ×2, BirdGuides |
| `lighting.high-iso-shadows` | Denoise first, sharpen strong edges only, judge at full size | Adobe, darktable, Nikon |
| `lighting.bright-background` | Lift the subject locally with an edge-aware mask, not global exposure | BirdGuides, Audubon, darktable, Cambridge in Colour |
| `lighting.high-dynamic-range` | Compress range first, then gentle local recovery; keep tonal order; watch edges for halos | RawPedia, darktable ×2, Cambridge in Colour, GIMP |

Reworded with citations: `lighting.underexposure`, `lighting.overexposure`, `subject.white-bird`, `subject.black-bird`. Newly cited existing rules: perched bird, bird in flight, garden bird, feathers, natural and documentary styles, harsh midday, backlit, dappled, fog, blue and overcast sky, wildlife in habitat, original framing.

## Birds and wildlife: what the sources agree on

- **White birds:** very little margin. Slightly darker whites usually show more feather texture; bright midday sun hides it (Audubon, White Birds).
- **Dark birds:** need different exposure from white ones; lifting a dark raw file costs noise and smooth tones (Audubon, BirdGuides).
- **Bright sky or background:** metering exposes for the background and leaves the bird dark (Audubon, BirdGuides). In editing, lift the bird locally; a graduated sky adjustment also darkens a bird that sits above its line (Cambridge in Colour).
- **Colour:** vibrance before saturation (Audubon, Dos and Don'ts).
- **Sharpening:** light; halos and crunchy feathers are as bad as softness (Audubon). Noise reduction softens feathers, so restrain it (BirdGuides).
- **Crop:** with care, leaving space ahead of a bird in flight (Audubon).
- **Authenticity:** tone, contrast, dodging and burning, crop, sharpening, noise reduction and lens cleaning are allowed in Wildlife Photographer of the Year; adding, moving or removing anything, composites and AI-added content are not (NHM rules 5(6) and 5(7)). World Press Photo also bars AI upscalers. Kestrel must never claim an edit is competition-compliant.

### Capture-side figures (context only, not engine values)

| Situation | Figure in source | Source |
| --- | --- | --- |
| White or pale subject on pale background | +0.5 to +1 EV | BirdGuides |
| Dark subject on dark background | −0.5 to −1 EV | BirdGuides |
| Small light subject on dark background | −1 EV | BirdGuides |
| White plumage via highlight alerts | raise until it blinks, then back off ⅓ to ⅔ stop | Audubon, White Birds |
| Habitual protection of highlights | about −½ stop | BirdGuides |
| Dark osprey scene / bright sun / light background | +⅔, −⅔, +⅓ stop | Nikon (Z8) |
| Noise ceiling on Auto ISO | ISO 6400 (Z8/Z9) | Nikon |

These explain why Nikon Z8/Z5II raw files often arrive slightly dark or with protected whites; they do not become slider values.

## Sources and licences

| Id | Source | Licence position |
| --- | --- | --- |
| audubon-editing | Audubon, *The Dos and Don'ts of Editing Bird Photos* (2017) | © National Audubon Society; cite and paraphrase only |
| audubon-white-birds | Audubon, *How to Photograph White Birds* (2017) | as above |
| audubon-exposure | Audubon, *How to Get the Right Exposure for Photographing Birds* (2016) | as above |
| audubon-ethics | Audubon, *Guide to Ethical Bird Photography and Videography* (updated 2026) | as above |
| birdguides-exposure | BirdGuides, *Bird Photography Tutorials 5: Exposure* | publisher's copyright; cite only |
| nikon-bird-setup | Nikon USA, *Customize Your Mirrorless Camera* (bird photos) | publisher's copyright; cite only |
| darktable-* | darktable user manual 5.6 and development: highlight reconstruction, filmic rgb, tone equalizer, color reconstruction, workflow | no licence on the pages; cite only |
| rawpedia-* | RawPedia: Exposure, Shadows/Highlights | no licence seen in page text; cite only |
| adobe-sharpen-noise | Adobe, *Sharpening and noise reduction in Camera Raw* | Adobe copyright; cite only |
| wpp-manipulation | World Press Photo, *What counts as manipulation* (2027 contest) | publisher's copyright; cite only |
| cambridge-grad-nd | Cambridge in Colour, *Using Graduated Neutral Density Filters* | © Cambridge in Colour; cite only |
| nhm-wpy-rules | Natural History Museum, *Wildlife Photographer of the Year adult rules* (2026) | © NHM Trustees; cite only |
| gimp-shadow-recovery | GIMP, *Tone Mapping and Shadow Recovery* (Elle Stone) | CC BY-SA 3.0; paraphrased, so no share-alike text enters Kestrel |

Checked but not usable: Canon's Bird Branch lesson pages (English site closed). Not used: reader comments on PhotographyLife (not editorial content).

## Gaps and next steps

1. **Most non-wildlife rules are still house practice** (portraits, food, architecture, night and astro, weddings). Next pass: the darktable and RawPedia pages for those genres, Cambridge in Colour on night and HDR, and a professional body's guidance on portrait skin.
2. **`styleLibrary.ts` (14 subjects of slider recipes) is still not wired into the editor** and has no sources. Decide whether to wire it as "Styles for this subject" or retire it in favour of this library.
3. **Calibration:** none of this is measured on Kestrel output. Before promoting any rule past `provisional`, compare before and after renders on licensed Nikon Z8/Z5II frames.
4. **Policy hook:** the new rules resolve and carry citations, but `photographyPolicy.ts` does not yet map them to `preserveLight`, `preserveDark` or `preserveSoft`. Left alone here because `naturalAuto.ts` is under an open claim.
