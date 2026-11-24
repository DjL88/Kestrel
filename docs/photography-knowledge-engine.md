# Photography knowledge engine / Kite44

Offline master: src/core/photographyKnowledge.ts. Draft editorial guidance is not objective ground truth, nor verified source-by-source. Verify references and calibrate with photographers before promotion. The resolver returns matched advice, not pixel edits. No production deployment or data collection is enabled.

## Storage
Git is authoritative. Publish reviewed immutable packs to Firestore photographyKnowledgeVersions/{version} with a separate signed active manifest, using admin-only writes and read-only client access. Keep large payloads in signed Cloud Storage objects if needed. Validate schema, signature, digest, compatible engine version and size before atomic local activation; retain bundled fallback and last known good version. Never require network for editing. Persist pack version and actual recipe in project catalogue, not original bytes.

## Integration
1. Obtain subject/scene/light/composition observations and confidence from existing local models. Never substitute a guessed label for an unknown result.
2. Resolve guidance for all confident dimensions plus explicitly chosen style. Resolve conflicts in favour of authenticity, technical safety and user intent; style cannot override hard gates.
3. Translate guidance and measured image statistics into supported, bounded engine operations and existing masks. No arbitrary fixed slider recipe or model-generated pixels. Unsupported operations must remain unavailable.
4. Render original, natural, subject-focused and personal candidates using the same colour-managed pipeline as export. Compare actual pixels and reject regressions (clipping, lost texture, halos, leakage, subject crop, banding). Low confidence or missing measurement means abstain. Derive explanations from actual operations. Never silently change crop.
5. Solo offers advice; Co-Pilot previews; Auto-Pilot applies only validated sufficiently confident candidate with Undo. Persist provenance, policy/model version and recipe.
6. Kite44: opt-in only, feature/recipe feedback separate from images. No EXIF, paths, identifiers or photo upload by default. Retain consent version, candidate/accepted recipe, rejection reason, model/pack version; separate personal preference from aggregate competence. No upload or collection enabled by this seed. Validate on camera/genre/lighting strata with burst-disjoint train/test data, licensed image pairs and independent human ratings.

## Research leads
Cambridge in Colour, Audubon, Nikon, Darktable (links in seed). Further references: Adobe Lightroom masking https://helpx.adobe.com/lightroom/desktop/edit-photos/masking.html ; MIT-Adobe FiveK https://data.csail.mit.edu/graphics/fivek/ (verify licences before use); World Press Photo https://www.worldpressphoto.org/contest/verification-process/what-counts-as-manipulation (competition-specific restrictions; never imply compliance). Review individual rule citations before publication.

## Acceptance
Existing core test glob includes resolver tests. Run npm test, npm run lint, npm run build and real RAW/preview/export parity tests before merge or activation. Seed is not connected to Auto-Edit yet. Integrate under existing grouped editing/model work, coordinate claims in #890 and avoid overlapping worker PRs.
