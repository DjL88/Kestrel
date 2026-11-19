# Kestrel Select: labelled evidence, not a model benchmark

Run locally (Python standard library only):

```sh
python3 -m unittest discover -s tools/cull-evidence -v
python3 tools/cull-evidence/evaluate.py /path/to/private-anonymous-results.jsonl
```

Each JSONL record must have these seven required fields (one photo per line), plus an optional independently annotated `subject_size`:

```json
{"id":"fixture-001","truth":"aircraft","predicted":"bird","decision":"review","keeper":true,"auto_species":"Osprey","provenance":"real-labelled"}
```

- `id`: stable anonymous unique identifier using only ASCII letters, numbers, hyphens or underscores (up to 80 characters); **never** a path, filename, EXIF, location or person name.
- `truth`: independent human annotation: `bird`, `aircraft`, `person`, `other-animal`, `other`.
- `predicted`: the app's **general subject** decision, including `unknown` for abstention.
- `decision`: app's automatic `keep`, `review` or `reject`, before manual intervention.
- `keeper`: human annotation that rejecting this image would discard a keeper.
- `auto_species`: the automatically applied species label, or `null`. **Do not** put user-entered or merely suggested labels here.
- `provenance`: `real-labelled` only for independently reviewed real photographs; otherwise `synthetic`.

- `subject_size` (optional): independent human annotation of subject visibility: `normal`, `tiny`, `distant`, or `unknown`. Missing means `unknown`, **not** normal. Never infer size from the model prediction. The evaluator reports the tiny/distant bird denominator, abstentions, review-only and false automatic rejects, plus unknown-size bird counts. No subgroup accuracy claim without real labelled examples and documented annotation rules.

Output includes the subject confusion matrix, abstentions, review-only decisions, false automatic rejects of human keepers, and aircraft/Osprey automatic labels. Counts do **not** establish calibrated model confidence, correctness of bird species, or absence of false negatives outside the sample. The `real_500_photo_benchmark` flag is only an input-count/provenance check, **not independent verification** of labels or a passing score. Report capture sources, label protocol, reviewer disagreement, model/build version, hardware, denominators and uncertainty separately before any published accuracy claim.

Never commit private image data, file paths, owner photos or personally identifying annotations. Keep the labelled input locally; publish only reviewed aggregate counts. Tests use synthetic records, not actual birds or helicopters.

## Stratification and coverage

The report separately lists `real_truth_counts`, `real_small_bird_count` and `coverage_gaps`. The legacy `real_500_photo_benchmark` field is **only** a count/provenance check: 500 real-labelled birds with zero aircraft do **not** establish aircraft-negative performance. Missing real aircraft, ordinary birds, tiny/distant birds or non-bird negatives are explicitly reported. Synthetic examples never fill real-photo coverage. Presence of one example in a stratum is **not** adequate statistical power, calibration, reviewer agreement or verified model accuracy. For a credible evaluation, pre-register minimum per-stratum counts, independent annotation protocol, confidence intervals, abstention and false-auto-reject denominators, and the exact app/model build. Keep source photographs and private labels local.

## Real-only safety denominators

`real_risk_denominators` and `real_risk_events` separate independently labelled real-photo records from synthetic fixtures. The four denominator groups are **real aircraft**, **real non-animals** (aircraft/person/other), **human-labelled real keepers**, and **human-labelled real tiny/distant-bird keepers**. Their corresponding event counts include aircraft incorrectly auto-tagged Osprey or another species, non-animals automatically assigned any species, and human keepers automatically rejected (including the tiny/distant subgroup). The original top-level counts still include both synthetic and real inputs for backwards compatibility.

A zero denominator means **no evidence**, not a 0% error rate. Do not divide by zero, derive significance from a handful of examples, or claim this report proves a deployed model's real-world performance. To estimate error rates or uncertainty, first validate the capture/model-build provenance, independently reviewed annotations, sampling strategy and per-stratum sample sizes. Data stay local; publish only reviewed aggregate counts.
