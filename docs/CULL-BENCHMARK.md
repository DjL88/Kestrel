# Kestrel culling benchmark — methodology

This harness measures **photographer-labelled shortlist recall**, not AI detection accuracy or real-world performance by itself.

## Ground truth

Use consented local photos with stable per-photo IDs. Have the photographer mark **favourite** when a photo must survive the first-pass shortlist; optionally mark **unusable** for a genuinely unacceptable frame. Label each photo as birds, aircraft, people, mammals or landscapes. Preserve the labels separately from model predictions. Never upload private images to evaluate them.

## Run and interpret

Call `evaluateCullBenchmark(labels, suggestions)` with the exact per-frame culling suggestions. The benchmark counts a frame as retained if the model says Keep **or undecided**. An absent or duplicate prediction is treated as unknown and kept for manual review, with missingPredictions reported. This makes recall conservative about photo loss but means a model that recommends reviewing *everything* has 100% recall and low precision. Always report **recall, precision, missing predictions, review volume, and per-category recall together**. Do not present the synthetic fixture as measured model performance.

## Acceptance gate

Target >=95% favourite recall overall, with category-specific reporting; explicitly inspect every falsely rejected favourite. Measure the number of frames needing manual review and compare against a no-auto-cull baseline. Validate on real, photographer-labelled mixed-camera shoots before claiming production quality. This harness does not establish calibration, image quality, or end-to-end UI correctness.

## Synthetic fixture

`src/core/cullBenchmark.test.ts` contains ten deterministic, artificial labels spanning all five categories. It tests metric semantics and failure modes only; it does not score real images or run subject detection. Run `npm test` and `npm run lint` in a repository checkout, plus Playwright review workflow before merging.


## Input-quality safeguards

The evaluator rejects blank/duplicate IDs, unknown categories, non-boolean labels and contradictory favourite/unusable annotations. A malformed prediction (invalid decision, confidence, or non-finite/out-of-range score) cannot remove a favourite: it is counted as missing and remains reviewable. Duplicate prediction IDs are likewise treated as unknown. Unexpected predictions outside the labelled shoot are reported separately. Inspect `invalidPredictions`, `duplicatePredictions`, `unexpectedPredictions`, `missingPredictions`, and `predictionCoverage` before accepting recall numbers. These checks protect the benchmark, **not** the production culling algorithm itself.

The benchmark reports two different precision measures: `precision` means **photographer favourites among all photos retained for review**, while `autoKeepPrecision` means **favourites among explicit automatic Keep decisions**. An undecided photo contributes to review workload, not to automatic-Keep precision. A null auto-Keep precision means no automatic Keeps were made; it must not be presented as 100% accuracy.
