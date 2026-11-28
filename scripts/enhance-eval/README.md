# enhance-eval: headless evaluation of the closed enhance loop

```bash
# once: make 2048 px working previews of the RAWs (macOS decoder), outside Git
mkdir -p ~/code/kestrel-test-photos/previews-2048
for f in ~/code/kestrel-test-photos/raw/*; do b=$(basename "${f%.*}"); sips -s format jpeg -s formatOptions 90 -Z 2048 "$f" --out ~/code/kestrel-test-photos/previews-2048/$b.jpg; done

npm run enhance-eval -- --out ~/code/kestrel-test-photos/enhance-eval/run-1      # all groups
npm run enhance-eval -- --dev-only --out /tmp/x                                   # tuning runs: never loads held-out groups
npm run enhance-eval:debug -- DSC04880 dark                                       # one photo, round by round
```

Output: `report.md` (tables per category and per flaw, development and held-out separately, where it fails, which rules never
fired), `report.json`, `contact-sheet.html` (before / round-by-round / three options, favourite marked by an outline and words).

## What is real and what is not

| Part | Status |
|---|---|
| The loop (`src/core/enhanceLoop.ts`), rules, sources, gates, render (`renderRecipePreview`), Natural Auto seed | Real code, the same that the app uses |
| Photographs | Open-licensed (raw.pixls.us, CC0) RAWs, decoded by macOS `sips` into JPEG previews. **Not** Kestrel's RAW decoder. Never committed |
| Vision AI | **Stand-in** (`standInVision.ts`): a deterministic critic from different measures. It makes no scene claims, so vision observations are not exercised, and its "favourite" is not the real model's. The real on-device model cannot run headless here (weights are not in Git and the runtime belongs to the desktop app) |
| Flaw variants | Synthetic (known degradation of a real photo). Truth = the undegraded original, so recovery error is an independent measure |
| Subject | The in-focus area measured from the pixels (`source: detail`), not a segmentation model |

Subject categories in `categories.json` were assigned by eye. `group` keeps near-identical frames together; the held-out
split is a fixed hash of the group name and `--dev-only` never loads those groups.
