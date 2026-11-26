# Quality benchmarks: what Dave drops in, and how to run them

Three offline harnesses (and one recorded pre-check, section 4) turn your own photos into honest numbers. Nothing is uploaded, originals are only read, and
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

## 4. Aircraft tagging on Mach Loop bursts (`x-uat-machloop` pre-check, 26 Nov 2026)

A dry run of the vehicle tagging from #1450–#1540 before your own Mach Loop shoot. It used **70 open-licence frames
shot at the Mach Loop** (CAD East, CAD West, the Bwlch and Corris Corner), found on Wikimedia Commons by searching
"Mach Loop", "Corris Corner", "Cad East" and "Cad West": 65 CC BY 2.0, 2 CC BY-SA 2.0, 2 CC BY 4.0 and 1 CC0, mostly from
two photographers' Flickr albums. None of your photos were used, and no photo, crop or result is committed.

**What ran.** The app's own core code (`routeSubject`, `readVehicle`, `textBoxes`/`decodeText`, `withMarking`,
`findMarkings`, `lookUpMarking`, `carryVehicleReadings`) with the app's pinned models: the bundled CLIP ViT-B/32 gate
(`clip-vit-b32-vision-uint8.onnx`, SHA-256 `b9544875…`) and the opt-in markings reader, PP-OCRv5 mobile (detector
`a4319856…`, recogniser `b5f833df…`, both matched their pins), on onnxruntime-web 1.31.1 (WASM, one thread) in Node with
the network not used after download. Model load took 2.0 s; the median per frame was 234 ms for the gate and 829 ms for
the text reading. The frames were 1280-pixel Commons copies, not RAW files. Every frame's true aircraft, and every
registration, was checked by eye.

**Bursts.** Commons gives capture times to the minute only, so frames from one photographer's series no more than two
minutes apart were treated as one burst: 21 bursts, 13 of them with more than one frame (up to 15).

| 69 aircraft frames | Each frame alone | After burst carry |
|---|---|---|
| Right type named ("probably BAE Hawk") | 9 (13%) | 10 (14%) |
| Right kind ("Military jet", "Military transport"), type unknown | 41 (59%) | 49 (71%) |
| "Aircraft", kind unknown | 18 (26%) | 8 (12%) |
| Wrong kind | 1 (1.4%) | 2 (2.9%) |
| Wrong type named | 0 | 0 |

The one frame without an aircraft (an empty valley road) was left untagged.

- **Types come only from registrations.** CLIP never named a type on its own: every F-15E, C-130J, MC-130J, Hawk T1,
  Tornado and Chinook stayed at "type unknown", as the 0.75 / 0.5 bars intend. All the named types came from a read
  serial inside the UK military serial blocks (Hawk T2, ZK010–ZK037), worded "probably".
- **Registrations read.** 11 frames carried a UK serial that a person can read at 1280 pixels. 9 were read exactly
  (ZK023 on 7 frames, ZK036 on 2), and none was misread. The Texan T1's ZM341 was read as "ZM34" on both frames, which
  is not a valid serial, so nothing was tagged: unknown stayed unknown. ZM341 is in the Texan block, so with a sharper
  read it would also have been named.
- **Never guessed from other text.** The USAF serials on the F-15Es and MC-130Js ("35776", "303", "327"), the "LN" tail
  code and the photographers' watermarks were all read as text and all ignored, because no supported format matched.
  US military serials are not a supported format, so USAF aircraft can't be named by serial yet.
- **The one wrong kind**, an MC-130J seen nose-on and banked, was read as a military jet (probability 0.60, right at the
  bar). In its two-frame burst it was carried to the other frame, which on its own had been "Aircraft". So a weak
  wrong kind can spread through a burst. Raising `kindMargin`, or not carrying a reading whose own kind probability
  is near the bar, would stop that.
- **Burst carry worked as designed.** It turned 9 "Aircraft" frames of the RAF C-130J burst into "Military
  transport". It carried ZK023 to the one frame of its burst where no serial is visible, which is right if that burst
  is one aircraft (its caption names the same squadron), so it is counted as a right type above. The two ZK036 frames shot in the same minute kept their own serial, because a frame's own register
  match is never overwritten.

**What this did not cover.** The Vision guardian was **not run** (it needs the desktop model), and neither was the object
detector that limits text reading to the aircraft's box. Text was read from the whole frame, which is the app's fallback,
so the app is likely to read more serials. The gate looked at the centre square, not the subject crop. There were no
Typhoon, F-35 or A400M frames, the jets you'll most often see at the Loop. Their serial blocks are listed, but they
weren't measured here.

**What to expect from your shoot.** Most frames will say "Military jet" or "Military transport" with the type unknown.
A type will be named when a UK serial is sharp and readable, and then the whole burst gets it. You'll name the rest
once per burst. A wrong type is unlikely, but check any burst whose kind looks wrong, because one weak frame can carry a
wrong kind.

Re-running: the fetch, run and score scripts are kept in the project files (`machloop-benchmark/`). They need `sharp`
installed outside the repo, and the two markings-reader files from the pins in `src/providers/markingReader.ts`.

## Where each check runs in the app

- **Edit looks natural:** every Co-pilot and Auto-Edit suggestion, and before Auto-pilot applies anything (#1447, #1594).
- **Subject found and mask complete:** a subject mask, once per shape, after its effect is checked. A "no" adds a
  notice asking you to check the mask's edges. The mask itself is never changed.
- **Species plausible:** before an automatic species name is added. A "no" leaves the photo for you to name, like a
  disagreeing BioCLIP 2 validator.
- **Vehicles and aircraft:** already guarded by name level (`vehicleGuardian.ts`).

All of these need the desktop app with the on-device model installed. Without it, nothing is asked and nothing changes.
