# From Kestrel to InFlight

v2.2 · original kite · chevron tail · gradient wings · Pro silver

The red kite concept is strong: it has a clear silhouette, and the forked tail doubles as an upward chevron. This pass keeps the idea and fixes the craft. The artwork is rebuilt as symmetric vectors, with one colour system that works on light and dark, and the chevron is cut from the bird itself.

Review

## Before and after

Original InFlight logo concept

Concept, raster

Refined, vector

1. **Two oranges**The chevron file is #B95523 and the kite file is #BF5824. That kind of drift shows up straight away when the icon sits beside the logo. Both files now use one rust, plus a brighter tuned rust for dark backgrounds.
2. **Wingtip goes muddy on dark**The crimson is only 1.4:1 against the rust and 3:1 against near-black, so the two-tone smears into brown. Light mode now uses a deeper Wingtip and dark mode a lifted one, keeping both above 3:1 for graphics.
3. **Raster artefacts**The chevron PNG has faint grey ghost strokes, and the tail notch has a 1px spike. Everything is redrawn as vectors with a crisp V notch.
4. **Asymmetry**The left and right wings and tail tips differ by a few pixels in the source. The new artwork is mirrored from one half, so it is exactly symmetric.
5. **Feather slits**The concept's slits taper to hairlines. They're kept as drawn because they give the bird its character, but they fill in below about 100px. Below 64px, switch to the chevron.
6. **Tail is the chevron**The concept's tail had a soft notch with a small spike, and its angles differed from the standalone chevron. The tail is now the chevron exactly, blended smoothly into the waist, so the icon and the bird are visibly the same mark.
7. **Bird shape**v2.0 uses your original kite, traced as clean vectors and mirrored from one half. Only the tail changes. The wordmark spans 62% of the wingspan, matching the concept lockup.
8. **Wordmark**The concept type had uneven F–l spacing. The wordmark is now Plus Jakarta Sans 700, the same family as the app UI, at −2% tracking with kerning applied. It is outlined and spans 66% of the wingspan.

Logo

## Stacked logo

Use it for the splash screen, marketing and the About screen. The wordmark spans 62% of the wingspan, and the gap below the tail is half the cap height.

Logo

## Horizontal logo

Use it for app headers, docs and email. The chevron's tips sit on the baseline and its apex rises just above cap height, so it reads as one line of type.

Brandmarks

## Kite and chevron

The chevron is the kite's tail, with a rounded apex that echoes the head. Use the kite at 64px and above, and the chevron for anything smaller: app icon, favicon, avatars, loading states.

Colour

## Palette

Each colour has a light value and a dark value. The dark values are lifted, not inverted, so rust stays rust on a night background. Wingtip is a graphic colour only and is never used for text. On the kite it blends into rust along each wing as a linear gradient: solid Wingtip for the first 18% from the tip, fully rust by 62%.

**Kite Rust**Primary. Body, tail, chevron.`Light #BF5824Dark #E8743C`

**Wingtip**Wing gradient only. Never for text.`Light #9E2F45Dark #CC4D66`

**Ink / Contrail**Wordmark and text.`Light #16181DDark #F4EFE8`

**Paper / Night**Backgrounds.`Light #FAF7F2Dark #0E1116`

**Slate**Secondary text, Solo mode.`Light #5C6270Dark #9AA1AE`

Product

## Work modes

The fill shows how much InFlight is flying. That reads at 16px without a label, the meaning carries without colour for colour-blind users, and the series extends if you add modes later.

**Auto-pilot**InFlight flies. Solid chevron.

**Co-pilot**You fly together. Half-filled chevron.

**Solo**You fly. Outline chevron.

App icon

## Icons and favicon

Rust is the default store icon, and Night is the alternate icon for dark home screens. The chevron sits 4% below centre because its mass is top-heavy. The favicon switches colour with the system theme.

Rust app icon

Rust · default

Night app icon

Night · alternate

Paper app icon

Paper

Small app icon

40px

Favicon 32px

32px

Favicon 16px

16px

Pro

## Pro subscribers

There are two directions, and they work together. **A** keeps the brand colours and adds a silver PRO pill: Pro users still see the same InFlight, with a clear marker. **B** is a Silver edition for Pro-only moments, with the kite and chevron in steel and a metallic sheen. My recommendation: use A everywhere a plan is named (headers, paywall, receipts, plan tables), and keep B for the Pro welcome screen, the Pro splash and an optional alternate app icon. That way silver stays special and never replaces the brand.

Pro app icon, night

Pro · night

Pro app icon, paper

Pro · paper

Pill · light

Pill · dark

Pill rules: its height is 0.8× the cap height, it's centred on the cap height, and it sits 0.3× the cap height after the wordmark. The text is Plus Jakarta Sans 800 with wide tracking. In the light theme the pill is steel with white text; in the dark theme it's bright silver with night text.

Motion

## Lottie splash: "Unfold"

The native splash shows the chevron alone. The animation picks up from that exact frame. There's no morph: the whole bird fades in around the chevron as one shape while the wings open from a gentle fold at the shoulders. The bird makes one wingbeat, then the wordmark settles in. It runs 2.8s at 30fps on a transparent 1080 × 1080 canvas and is about 23KB. Tap a tile to replay it.

| Frames | Beat | Motion |
| --- | --- | --- |
| 0–6 | Handoff | Holds on the chevron at 26% width, identical to the native splash icon (marker `handoff-from-native-splash`). |
| 6–28 | Reveal | The full bird fades in as one shape around the chevron while the rig eases back to the final lockup scale. |
| 8–44 | Open | The wings start 32° down at 75% scale and sweep open from the shoulders. They overshoot 6° past level and settle. They stay attached to the body throughout. |
| 48–68 | Wingbeat | One downstroke (9°) and recovery. The bird rises 12 units with the stroke and settles. It doesn't loop. |
| 44–62 | Name | The wordmark fades in and rises 24 units. |
| 62–84 | Hold | Rests on the final lockup, then hands over to the first screen with a 200ms cross-fade. |

Implementation: on iOS use `lottie-ios`, on Android `lottie-android` with the SplashScreen API, and on the web `lottie-web` with the SVG renderer. Load the `-dark` or `-light` file to match the system theme. With reduced motion on, skip straight to the last frame.

Usage

## Rules

**Clear space**One kite head-width on every side. For the horizontal lockup, half the cap height.

**Minimum size**Kite 64px, stacked logo 120px wide, horizontal logo 20px tall, chevron 12px.

**Match the ground**Use the -light files on light backgrounds and the -dark files on dark ones. Use mono on photos and for single-colour print.

**Don't recolour**Keep Wingtip off the body and rust off the wordmark. Don't add gradients or outlines.

**Don't retype**The wordmark is outlined, with kerning applied. Always use the SVG.

**Don't rotate**The chevron always points up, because it means climb.