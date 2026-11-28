# Own species model: clean foundation (research preview, off by default)

Owner decision, 28 Nov 2026: BioCLIP, BioCLIP 2 and the species vectors made with them are RED on licence
(`licence-report.md`) and are switched off for beta. InFlight is to have **its own** species model on a clean footing.
This is the first step: prove the pipeline end to end on a frozen, openly licensed embedding and the owner's own photos.
It is a research preview, not a replacement for the species feature.

## What was built

| Piece | Where | Notes |
|---|---|---|
| Embedding | the DINOv2 ViT-S/14 the app already ships for burst grouping (`public/models/dinov2-small-fp16.onnx`, Apache-2.0, Meta) | Frozen. Same input path as `src/core/visualSimilarity.ts` (centre 224 of a 256 resize, ImageNet mean/std), so the **stored 384-number burst embedding is reused: no extra model run, no extra download**. |
| Head | `src/assets/species-own/head.json` (a few KB) | Linear head or prototypes on the unit-length embedding, plus two abstain gates. Refuses to run on any other embedding model (id and file hash are checked). |
| Classifier | `src/core/ownSpeciesModel.ts` (pure, tested) | Abstains unless the top share and the closeness to a trained species are both high enough. |
| Seam | `identifySubject` in `src/providers/autoSpecies.ts` -> `src/providers/ownSpecies.ts` | Same `SpeciesGuess` the BioCLIP path returns, so Auto and the editor need no change. |
| Switch | preview "Own species model (research)", off by default (`kestrel.preview.own-species.v1`) | When PR #1958's kill-switch registry is on `main`, add an `own-species-id` entry there (device scope, `previews: ['ownSpecies']`). The BioCLIP kill switch (`species-id`) does not affect this path, by design: the own path has no BioCLIP code in it. |
| Tools | `scripts/species_own/` (Python, local only) | `sample.py`, `embed.py`, `candidates.py`, `train_eval.py`, `folder-labels.json` (the reviewable folder-to-species map). |

No photos, previews, embeddings or reports are in Git. They live under `~/code/kestrel-test-photos/species-own/`.
The drive is only read.

## How labels work (nothing trained on a guess)

`folder-labels.json` maps the owner's folder names to species **only where the name says so** ("Kingfishers",
"Ospreys", "Puffins"; shorthand such as "Dipdips" for dippers, "KF", "Kites" is marked `nickname` and "Kite Workshop"
and "Dipper Walk" `mixed`). Ambiguous folders (heron trips, the whole Skomer trip, "Trains Kites", wrens, nuthatch,
buzzard) are left out and the reason is written next to them. `candidates.py` writes a report with counts and a thumbnail
sheet per species so the owner can confirm each row. **Until a row is confirmed the head is flagged
`labelsConfirmed: false`, the classifier marks every answer `provisional`, and the preview text says so.**

## Evaluation rules

- **Held out by shoot day, never by random frame.** Burst frames are near duplicates, so a random split would leak.
  Every frame of a shoot is held out together (leave-one-shoot-out), and each species and each shoot counts equally in
  training.
- Frames come from the in-camera or edited JPEG, else the RAW's embedded preview (else the system decoder), capped at
  about 80 per folder and spread over the shoot days.
- Reported: top-1 and top-3 per species, a confusion matrix, an abstain curve (coverage against accuracy when named),
  and how often a **non-target** photo (a dog show, castles, beaches, re-enactors, and unconfirmed "birdies" folders)
  is wrongly given a species name.
- Comparison with BioCLIP, if any, is non-shipping research context only and labelled so.

## Results (28 Nov 2026, leave-one-shoot-out, UNCONFIRMED folder labels)

Data: 927 labelled frames from 25 shoots (5 species) and 508 out-of-set frames (279 non-bird scenes, 229 unconfirmed
"other bird" frames). Embedding: the shipped DINOv2 ViT-S/14 run through onnxruntime-web (the app's own runtime).
Held out by shoot day. The numbers below are for the shipping candidate (linear head with a trained "not in list" class,
each out-of-set folder also held out).

| Species | held-out frames | top-1 (counting "not in list" as wrong) | top-3 | named (both gates) | correct when named |
|---|---|---|---|---|---|
| Atlantic Puffin | 45 | 0.91 | 0.96 | 38 | 38 |
| Dipper | 400 | 0.62 | 0.99 | 172 | 172 |
| Kingfisher | 165 | 0.76 | 0.83 | 96 | 83 |
| Osprey | 123 | 0.40 | 0.84 | 33 | 32 |
| Red Kite | 194 | 0.83 | 0.95 | 121 | 112 |

- It names about **half** of held-out frames (0.50) and is right on **0.95** of those it names. The abstain threshold
  was picked on these same held-out predictions to reach 0.95, so treat 0.95 as optimistic.
- Osprey is the weak species (distant raptors, confused with red kite and kingfisher); it is named rarely.
- Wrongly given a species name when it should say nothing: **3.9%** of non-bird scenes and **16%** of unconfirmed
  other-bird frames (an upper bound: those folders may hold target species).
- Why a "not in list" class: without it the closed-set head gave the same look-alike birds a name 66% of the time
  (nearly all "Dipper"), because a closed list always has a nearest species. Plain prototypes and a plain linear head are
  in `report.md` for comparison (macro top-1 0.77 and 0.79 with no abstaining class, but unusable on other birds).
- Parity: the TypeScript classifier on int8-stored embeddings agrees with the Python head on all 1,435 frames.
- Non-shipping context only: BioCLIP was not run here, so no comparison is made. A comparison, if wanted, would be
  research output and would stay out of the shipped path.

## Honest limits (repeat these wherever a number is quoted)

- Only the few species the owner photographed are covered. Everything else must abstain, and for birds that are not
  covered it only abstains as well as the gates allow (see the out-of-set table).
- Labels are folder names: label noise is unmeasured until the owner confirms them.
- One photographer, one camera system, UK sites. Backgrounds and places correlate with species in these shoots, so part
  of the accuracy may be scene recognition, not bird recognition. A new site could do worse than these numbers.
- The embedding sees the centre of the frame; a small off-centre bird is the main failure mode (a subject crop would
  help and is a later step).
- A head trained on a handful of shoots is a foundation, not a product.

## How it improves later

**Opted-in contributors (recipe and label only, no photos).** A person who has confirmed a species on their own photo
may choose to share one record: `{species name, 384-number DINOv2 embedding (int8), shoot-day bucket}`. The embedding
is computed on their device from the model they already have; it is not an image and cannot be turned back into one at
useful quality, but it is still personal data, so: off by default, explicit consent per account, no EXIF, no paths, no
account id on the record, a delete request removes every record, and the shared form is shown before it is sent. The
server only averages: new prototypes and a retrained head come back as a signed, versioned `head.json` (the same
signing as the other optional models, `src/providers/modelUpdater.ts`). Held-out evaluation stays by contributor and
shoot, and a species is added to the shipped list only when enough independent contributors cover it and the abstain
rate on out-of-set photos stays acceptable. Nothing is added from unconfirmed labels.

**Training in-house later.** The same recipe scales without changing the contract: more shoots per species (the
owner's other roughly 13,000 RAWs once folders are confirmed), a subject crop from the detector before embedding,
a larger frozen DINOv2 variant only if the Apache-2.0 weights are shipped and the size is accepted, and fine-tuning
only if an openly licensed, rights-cleared training set exists. Any new data source needs its licence checked the way
`licence-report.md` did; iNaturalist-derived sets are non-commercial and stay out.

## Attribution

DINOv2 (Meta AI, Apache-2.0): see `docs/notices/dinov2.txt` and `NOTICE.md`. The head file contains numbers learned from
the owner's own photographs and no image data.
