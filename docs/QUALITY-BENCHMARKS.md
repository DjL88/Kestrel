# Quality benchmarks: what Dave drops in, and how to run them

Three offline harnesses turn your own photos into honest numbers. Nothing is uploaded, originals are only read, and
none of your photos, labels or results go into Git. Run them from a Kestrel checkout after `npm ci`.

## 1. Blind comparison: InFlight against DxO, Lightroom and Topaz

Finish-line jobs `x-gap-benchmark`, `x-uat-highiso` and the TrueDetail check (`p3-maskdenoise`).

**You drop in:** 20 to 30 Z8/Z5II frames (ISO 3,200 to 25,600; white plumage and backlit feathers help), each exported
full size from every editor you want to compare, same colour space (sRGB), no crop. Include InFlight twice for the
TrueDetail check: once with Denoise on (TrueDetail) and once with only the plain Noise slider (one-model denoise).

1. Put the exports in one folder, for example `shoot/inflight/`, `shoot/inflight-plain/`, `shoot/dxo/`, `shoot/lr/`, `shoot/topaz/`.
2. Write `shoot/shoot.json` with one entry per frame and the 100% crops to judge, as `[x, y, width, height]` in pixels:

```json
{ "frames": [ { "id": "z8-0412",
  "outputs": { "InFlight": "inflight/DSC_0412.tif", "InFlight plain": "inflight-plain/DSC_0412.tif",
               "DxO": "dxo/DSC_0412.tif", "Lightroom": "lr/DSC_0412.tif", "Topaz": "topaz/DSC_0412.tif" },
  "regions": { "eye": [3120, 1410, 400, 400], "feather": [2800, 1900, 600, 600], "background": [400, 300, 600, 600] } } ] }
```

3. `python scripts/blind_compare.py make shoot/shoot.json shoot/blind/`
4. Open `shoot/blind/judge.html`. Each row shows the same crop from every editor under letters that change per row,
   with no names or file details. Pick the best (and the worst, if one stands out), then press **Save my choices**.
   Don't open `key.json` until you've finished.
5. `python scripts/blind_compare.py score shoot/blind/key.json ~/Downloads/picks.json > results.md`

`results.md` lists wins and losses per editor and per region, plus median detail and noise measurements. Publish the
wins and the losses together. The measurements describe pixels, not truth: sharpening or invented texture also
raises "detail". **TrueDetail's done-when line is met** when, on these frames, "InFlight" beats "InFlight plain" on
eye and feather rows and its background noise is lower.

## 2. Auto-Cull on a shoot you've already rated (`p5-cull`)

**You drop in:** a shoot you rated before (in camera, Lightroom with "write to XMP", Photo Mechanic...), and nothing
else changed.

1. Import the folder into InFlight as a new project. Your stars come in from the files; your rejects come in as rejected.
2. Press **Sort for me** (Auto-Cull) once and don't change any decisions.
3. Save a project backup (**Save backup file…** in the backup settings), giving a `.kestrel.json` file.
4. `npx tsx scripts/quality/cull-score.mts project.kestrel.json /path/to/shoot --stars 3 --category birds`

Ratings are read from each original's XMP or TIFF rating, or from a sidecar such as `DSC_0001.xmp`. A CSV
(`filename,stars,category`, with `-1` meaning rejected) also works: add `--ratings ratings.csv`. Photos with 3 stars
or more (`--stars`) are favourites. The report gives favourite recall (target 95% or more), every favourite Auto-Cull
rejected, by name, and every rejection made without high confidence (the rule is none). It also gives the precision of
Auto-Cull's own Keeps and how many photos are left for you to review. Photos you'd already rejected before import are
your mark, so they're never scored as Auto-Cull's.

## 3. The Vision guardian on a labelled set (`p3-guardian`)

The guardian (SmolVLM2, on device) answers one yes/no question before a result is shown: is this the subject, does the
mask cover all of it, is this the species, does the edit look natural. A "no" only ever holds a result for your
review. It never changes a value, and agreement never upgrades anything.

**You drop in:** a few dozen rights-cleared photos and `labels.json`. A mask is a black-and-white PNG of the whole
subject, for example exported from InFlight's subject mask after you've checked it by hand:

```json
[ { "id": "kite-1", "image": "kite-1.jpg", "subject": "bird", "species": "Red Kite", "mask": "kite-1-mask.png" },
  { "id": "a400m", "image": "a400m.jpg", "subject": "aircraft", "mask": "a400m-mask.png" },
  { "id": "oversat", "image": "oversat.jpg", "natural": false } ]
```

1. `npx tsx scripts/quality/guardian-benchmark.mts prepare labels.json > cases.json` (keep cases.json beside labels.json).
   For each check this asks one right claim and one wrong claim: another subject or species from your set, and a mask
   with the top 40% of the subject cut away. The questions are the app's exact words.
2. `cargo run --release --manifest-path crates/kestrel-vision/Cargo.toml --example guardian_eval -- <model folder> cases.json > answers.jsonl`
   The model folder is the one the app installed (Settings → On-device models shows it), so the same pinned model is measured.
3. `npx tsx scripts/quality/guardian-benchmark.mts score cases.json answers.jsonl`

The report gives, per check, how many wrong claims were held ("catch rate"), how many right ones were held needlessly,
how often the model was unsure, the median time per question, and a PASS or FAIL for "never upgraded a result". Fewer
than 20 right and 20 wrong claims per check is marked too few to judge.

## Where each check runs in the app

- **Edit looks natural:** every Co-pilot and Auto-Edit suggestion, and before Auto-pilot applies anything (#1447, #1594).
- **Subject found and mask complete:** a subject mask, once per shape, after its effect is checked. A "no" adds a
  notice asking you to check the mask's edges. The mask itself is never changed.
- **Species plausible:** before an automatic species name is added. A "no" leaves the photo for you to name, like a
  disagreeing BioCLIP 2 validator.
- **Vehicles and aircraft:** already guarded by name level (`vehicleGuardian.ts`).

All of these need the desktop app with the on-device model installed. Without it, nothing is asked and nothing changes.
