# Firecrest — Candidate Identity / Brand Guidelines v1.0

> **CANDIDATE ONLY — NOT CLEARED FOR PUBLIC USE.** This is a reversible brand proposal. FIRECREST has existing UK trade-mark and photography/media uses. Seek professional UK/EU clearance before exposing the name to customers, app stores or production builds.

## Positioning

**Make room for the photograph.** A calm, capable, local-first photography workspace for culling, RAW processing, true-detail enhancement, masking and export. The application should preserve authentic image information and aim for an end-to-end workflow without requiring multiple apps. Keep the principles of [PRODUCT-PHILOSOPHY](../../PRODUCT-PHILOSOPHY.md) intact.

## Geometry and logo

- An angular dusk-blue **F** is the structural anchor, preserving the energy of the original Kestrel K.
- A flat copper **firecrest** faces right. A restrained crimson underside and crown accent create depth without gradients, shadows or feather-by-feather illustration.
- **Never use AI-generated raster logos as the production source.** The SVGs here are the editable geometric masters.
- Use the **dark horizontal lockup** for large display uses; standalone SVG mark for compact product uses.
- Preserve at least **25% of mark width** as clear space. Check the brand at 16, 24, 32, 64 and 128 px. For tiny favicons, simplify rather than squash.
- No rotation, distortion, recolouring, outlines, glows, gradients, shadows, 3D treatment or photographic background clutter.

## Typography

| Role | Existing project family | Setting |
|---|---|---|
| Wordmark and display | **Plus Jakarta Sans** | ExtraBold 800, tracking −0.02em to −0.03em |
| Primary UI | **Inter** | Regular to Semibold; tabular numbers where relevant |
| Readable mode | **Atkinson Hyperlegible** | Retain the accessible opt-in |

Use fonts already bundled with Kestrel; do not introduce another font library. Keep British English by default.

## Colour (retain project tokens)

| Role | HEX | Use |
|---|---|---|
| Canvas | `#14161B` | Application background |
| Stage | `#12141A` | Neutral photo workspace |
| Panel | `#1A1D23` | Toolbar |
| Raised | `#1C2027` | Dialog, icon background |
| Ivory | `#F4EFE6` | Main text |
| Copper | `#C9652E` | Bird and primary actions |
| Copper hover | `#D97840` | Hover/active state |
| Dusk blue | `#4A88B2` | F, focus, selection |
| Wine crimson | `#C54F63` | Accent and underside |
| Mist | `#8B93A3` | Secondary text |

The CSS variable names `--color-kestrel-*` stay **unchanged** during candidate review to avoid a large breaking refactor. Preserve WCAG contrast and visible labelled state controls.

## Voice, product and UX

Speak plainly and precisely: “Try lifting the subject shadows.” “Your original stays untouched.” “Ready to export.” Avoid false claims like “AI perfected your image”, obscure internal model diagnostics, and overconfident identification. Let the photograph lead; use calm feedback, responsive loading states, accessible text and unobtrusive iconography.

## Source files

- `firecrest-symbol.svg` — full-colour transparent master
- `firecrest-symbol-ivory.svg` — monochrome master
- `firecrest-lockup-dark.svg` / `firecrest-lockup-light.svg` — editorial lockups
- `firecrest-app-icon.svg` / `firecrest-favicon.svg` — product size concept assets
- `tokens.json` — candidate tokens, fonts and minimum sizes

## Adoption and blockers

1. **Internal visual review:** assess small sizes and compare with the original Kestrel mark, splash/installer and branding.
2. **Trade-mark clearance:** UK/EU registered and common-law searches including software, photographic equipment, media, related brands, domains and app store names. Existing FIRECREST registrations include Firecrest Films Limited; get qualified review.
3. **Reversible feature-flag preview:** do not overwrite public Kestrel assets; ensure accessibility and translations remain intact.
4. **Technical inventory:** package/bundle IDs, local storage, SQLite, Firestore, API routes, licences, buckets, Firebase hosting, update signing, installer names, test fixtures and documentation references.
5. **Release gates:** test desktop/tablet/mobile, 16–128px icon legibility, splash, dark/light/contrast, favicons, installer, language, licensing and rollback.
6. **Only after clearance and explicit approval:** public product name, website, app store listing, download URLs, legal notices and marketing switch.

**Not a release authorisation**. Do not rename repository, app/bundle identifiers, database prefixes, hosting, secrets, data paths, signatures, customer-visible copy or asset imports from this exploratory PR.
