# Kestrel — Lucide import audit and direct brand migration
Date: 21 November 2026. Baseline main `29b679575e9ab7cb7ecbff6c67d06d647d2e4ce5`. Source: GitHub code search for `lucide-react` and individual source imports.

## Decision
Retain Lucide's recognised utility pictograms but **replace direct application imports** with `src/components/icons/KestrelUIIcons.tsx`. The Kestrel wrapper enforces one restrained 1.85px round optical weight, currentColor, inherited sizing, caller override and forwardRef. The three guidance birds are custom Kestrel silhouettes at 2px, not unrelated generic birds. The brand is a *coherent icon grammar*, not 90 decorative kestrels. Do not alter existing K logo before comparing its original vector source. Do not remove `lucide-react` dependency; it remains a declared ISC upstream dependency and attribution stays in NOTICE.

## Audited sources
GitHub search found **48 indexed paths**: 44 TSX components and 4 dependency/notice files (`package.json`, `package-lock.json`, `bun.lock`, `NOTICE.md` were visible among search hits; count is a search result, not an exhaustive filesystem census). The search includes source snippets and can miss files not indexed; rerun `rg -n "from ['\\\"]lucide-react['\\\"]" src` in a checkout.

### Migrated now (31 non-overlapping components)
`PaidNotice`, `ProviderIcon`, `SettingsButton`, `WorkspacePaneRail`, `RemovedPhotosPanel`, `FolderRegrantBanner`, `LanguagePicker`, `SpeciesScanBanner`, `Histogram`, `RatingFilterControl`, `DecisionButtons`, `ProjectActionDialog`, `LanguageWelcome`, `GuidedBanner`, `PresetPanel`, `Filmstrip`, `TaskManager`, `PhotoViewport`, `OpenShootModal`, `FrameImage`, `CompareView`, `FilterSortControl`, `LoupePreview`, `ProjectList`, `ConnectionsPanel`, `AutoCullPanel`, `ExifInspector`, `MacroPadModal`, `ExportPreviewTile`, `SpeciesSuggestions`, `VirtualizedContactSheet`.

### Deferred to the exact active file owners
`src/App.tsx`, `src/components/PhotoEditor.tsx` (integration coordinator; #670).
`src/components/MaskPanel.tsx`, `src/components/AppearanceDialog.tsx`, `src/components/QuickAdjust.tsx`, `src/components/SubjectPanel.tsx`, `src/components/FilmstripDock.tsx`, `src/components/FloatingPane.tsx`, `src/components/ExportWizard.tsx`, `src/components/TopWorkspaceBar.tsx`, `src/components/PhotoExportPanel.tsx` (shared integration or active overlapping changes).
`src/components/ColourCheckPanel.tsx` (#669), `src/components/AiReviewPanel.tsx` (advisor workstream).
All of these should replace `from 'lucide-react'` with `from './icons/KestrelUIIcons'` **only after owner handoff**; do not modify functionality or icon meaning. That is 13 named components, pending review of current claims.

## Semantic visual rules
- **Keep/Reject/Undecided:** preserve distinct check/X/help shapes AND visible text; no colour-only indication.
- **Warning/error:** preserve triangle and label; do not disguise a destructive action with a friendly bird.
- **Export/import:** retain directional arrows, destinations and readable labels; do not swap arrow semantics.
- **Loading:** preserve animation classes and `aria-live` context; do not animate all icons.
- **Soar/Glide/Fly Solo:** custom birds, with translated descriptive labels and no magic/sparkle treatment.
- **Responsive:** 16–24px marks, >=44px touch targets on mobile, focus-visible rings, currentColor contrast.
- **Accessibility:** preserve existing aria-label/title, avoid duplicate spoken names on decorative icons, test light/dark/high contrast.
- **Rights:** Lucide ISC dependency stays disclosed. Custom bird silhouettes are original project vectors inspired by owner's reference drawings; the original K logo remains authoritative.

## Integration, tests and release
This PR migrates imports without changing button semantics. Exact-head TypeScript, lint, unit, build, Playwright, Mac/Windows/iOS/Android and screenshot comparison **NOT RUN** in connector-only session. Run `npm ci && npm run lint && npm test && npm run build` and responsive/keyboard/contrast checks on a working checkout. Do not merge solely because GitHub Actions billing is blocked. Validate actual app views before claiming visual parity.

Follow-up coordinator: merge/rebase original flight-icon PR #672 safely; this branch includes its three commits and must **not** create competing divergent icon files. Resolve or supersede #672 after review. The final user-facing guidance control is owned by integration, not this isolated icon migration.
