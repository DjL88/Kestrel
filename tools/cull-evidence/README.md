# Kestrel Select: labelled evidence, not a model benchmark

Run locally (Python standard library only):

```sh
python3 -m unittest discover -s tools/cull-evidence -v
python3 tools/cull-evidence/evaluate.py /path/to/private-anonymous-results.jsonl
```

Each JSONL record must have **exactly** these fields (one photo per line):

```json
{"id":"fixture-001","truth":"aircraft","predicted":"bird","decision":"review","keeper":true,"auto_species":"Osprey","provenance":"real-labelled"}
```

- `id`: stable anonymous unique identifier; **never** a path, filename, EXIF, location or person name.
- `truth`: independent human annotation: `bird`, `aircraft`, `person`, `other-animal`, `other`.
- `predicted`: the app's **general subject** decision, including `unknown` for abstention.
- `decision`: app's automatic `keep`, `review` or `reject`, before manual intervention.
- `keeper`: human annotation that rejecting this image would discard a keeper.
- `auto_species`: the automatically applied species label, or `null`. **Do not** put user-entered or merely suggested labels here.
- `provenance`: `real-labelled` only for independently reviewed real photographs; otherwise `synthetic`.

For tiny/distant birds, retain a **separate private annotation** for subject size/visibility and report its independently audited subgroup counts. This v1 schema cannot compute a tiny/distant breakdown and must not claim one.

Output includes the subject confusion matrix, abstentions, review-only decisions, false automatic rejects of human keepers, and aircraft/Osprey automatic labels. Counts do **not** establish calibrated model confidence, correctness of bird species, or absence of false negatives outside the sample. The `real_500_photo_benchmark` flag is only an input-count/provenance check, **not independent verification** of labels or a passing score. Report capture sources, label protocol, reviewer disagreement, model/build version, hardware, denominators and uncertainty separately before any published accuracy claim.

Never commit private image data, file paths, owner photos or personally identifying annotations. Keep the labelled input locally; publish only reviewed aggregate counts. Tests use synthetic records, not actual birds or helicopters.
