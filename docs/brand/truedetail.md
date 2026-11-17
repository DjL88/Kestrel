# Kestrel TrueDetail — product and marketing foundation

**Technology name:** Kestrel TrueDetail  
**Promise:** See the detail. Keep it real.  
**Packaging:** Kestrel Pro (the existing Paid licence). **Not** a separate subscription.

## What it stands for

Natural, honest, exceptional photo detail. Prioritise authentic feather barbs,
eyes, fur, fine lettering and textures, without invented structure, edge haloes
or artificial oversharpening. Target a streamlined Auto workflow, not an expert
panel full of unnecessary decisions.

## Technology family (all unreleased)

| Feature | Intended capability | Status |
| --- | --- | --- |
| TrueDetail RAW | High-bit-depth development and demosaicing before lossy JPEG | Research |
| TrueDetail AI | Advanced noise reduction with detail preservation | Research |
| TrueDetail Select | Selective subject-aware noise/detail controls | Planned |
| TrueDetail Batch | Consistent processing across a full shoot | Planned |

The source of truth for readiness is `src/core/trueDetail.ts`. Paid ownership
alone must never turn on an unreleased control. Existing editing/export safety,
offline entitlement, and access to originals remain unchanged. Don't gate basic
camera decoding, safe recovery or existing full-resolution export behind these
future paid features.

## Public landing-page copy — approved development-state version

### Kestrel Pro. Powered by TrueDetail.

**See the detail. Keep it real.**

A new generation of intelligent RAW processing is being developed for Kestrel
Pro, designed to preserve the subtle details that make photographs extraordinary.

From fine feathers to the textures of a landscape, TrueDetail aims to reduce
noise while retaining the natural character of the photograph.

**In development.** Camera support, results and availability will be confirmed
through published real-world testing. Existing Kestrel capabilities are
described separately from these future features.

### Proposed launch CTA
**Follow TrueDetail development** — only connect to a real, opt-in list when
the site has an approved privacy notice and mailing platform. Until then, use
a non-functional static announcement without a faux sign-up action.

## Demonstration rules

- Use real, rights-cleared Nikon Z8/Z5II NEFs and matched 100% crops.
- Show camera body, ISO, compression, firmware, exported format and crop.
- Keep exposure, white balance, framing, output colour profile and scale matched.
- Publish full-size sample output alongside crop comparisons where rights allow.
- Identify any beta/demo results as such. Do not imply DxO parity before
  independent benchmarking establishes it.
- Do not apply artistic AI generation to before/after comparison images.
- Benchmark true detail and artefacts, not merely a sharper-looking image.
- Include visible text alternatives and non-colour-only comparison cues.

## Design

Reuse the actual Kestrel brand kit (`docs/brand/README.md`): ink #F5F3EF,
copper #F2AE79 and dark stage #0C0E11. Keep the Kestrel mark dominant.
TrueDetail should be a restrained typographic sub-brand, not another mascot or
a competing logo. Use the tagline in accessible text, never baked into an image
without an equivalent text alternative.

## Launch gates

1. Conduct trademark/domain clearance before committing to paid advertising,
   packaging, trademark claims or asset purchases. This document is not legal
   clearance.
2. Confirm licensed redistribution rights for any SDK or neural model.
3. Verify Nikon HE, HE*, lossless, full-size colour and 16-bit round-trips.
4. Run blind comparison against NX Studio, DxO and other strong baselines.
5. Validate GPU/CPU fallback, battery, VRAM limits and end-to-end export.
6. Mark an engine `released` only after actual processing support, regression
   tests and honest sample results are approved.
7. Wire release state and existing Paid entitlement into the UI only when ready.
8. Set pricing after measuring costs and validating customers' willingness to
   pay. No price, delivery date or availability promises are approved here.

## Free versus Pro positioning

Free should remain a useful, respectful photo editor, with basic editing,
safe imports, recovery and existing export allowances. Pro may include
TrueDetail processing once shipped, alongside the Paid features already
defined by `src/core/features.ts`. Catalogue access and original photographs
must never become inaccessible when an entitlement expires. Offline licences
must continue to work without a mandatory cloud connection.
