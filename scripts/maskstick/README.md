# Mask measuring stick

Score any subject-mask source against masks the owner has fixed by hand, so "is it better?" has a number. Research
tooling for the own-models plan (masks and fine edges first). It is not part of the app and nothing here changes
`src/`. Needs Python 3.9+, numpy, scipy and Pillow (the baseline runner also needs `npm ci`). No model weights, no
network, no accounts. Owner photos, previews and masks live outside Git (`~/code/kestrel-test-photos/maskstick/`); only
synthetic fixtures are used in tests.

Run everything from `scripts/` (`cd scripts`); the examples use `python3 -m maskstick.<module>`.

## The stick

| File | What it does |
|---|---|
| `metrics.py` | Mean IoU, soft IoU, boundary F-score at 2, 4 and 8 px, and an effort-to-fix proxy (error regions + outline length, in the spirit of IS-Net's HCE). |
| `score.py` | Scores one or more mask folders against the fixed masks; paired bootstrap difference between two sources; flags photos where the owner started from that source's mask. |
| `select_heldout.py` | Picks the frozen held-out previews from the owner-pairs index (metadata and focus statistics only, nobody has to look). |
| `fixer.py`, `fixer.html` | A small local paint-and-save helper (loopback only) for fixing masks, with a "can't tell" edge band. |
| `baseline-shipped.ts` | Headless replica of the shipped default mask path (YOLOX box, U²-Net-P, guided-filter outline, the editor's own mask evaluator). |
| `matte/` | The no-model soft-edge matte: focus map, trimap, closed-form matting (Levin 2008). Research prototype, not wired in. |
| `bench_synth.py`, `synth.py` | Controlled failure-mode run on procedural scenes with a true alpha. |
| `diagnose.py` | What two sources show before any mask is fixed: coverage, refusals, agreement. Not accuracy. |

Masks are 8-bit grey PNGs named `<key>.png`, any size with the photo's aspect. Ground truth: 255 subject, 128 "can't tell"
(feather tips, fur: ignored by every metric, so no source is rewarded or punished there), 0 background. Boundary F counts a
boundary pixel as right when the other mask's boundary is within the tolerance (2, 4, 8 px at the ground truth's size; the
owner-pairs previews are 1024 px on the long edge). A source that declines (no mask file) is scored as an empty mask with
`--missing empty`, so declining is never free.

## Workflow

```bash
cd scripts
M=~/code/kestrel-test-photos/maskstick
# 1. once: choose and freeze the held-out photos (writes only under $M)
python3 -m maskstick.select_heldout --out $M
# 2. suggested masks to start from, one folder per source
npx tsx maskstick/baseline-shipped.ts --in ~/code/kestrel-test-photos/owner-pairs/previews --keys $M/heldout.json --out $M/proposals/shipped
python3 -m maskstick.matte.pipeline --previews ~/code/kestrel-test-photos/owner-pairs/previews --keys $M/heldout.json --out $M/proposals/matte
# 3. the owner fixes ~30 masks at http://127.0.0.1:8765
python3 -m maskstick.fixer --manifest $M/heldout.json --proposals shipped=$M/proposals/shipped --proposals matte=$M/proposals/matte --gt $M/gt
# 4. score
python3 -m maskstick.score --gt $M/gt --source shipped=$M/proposals/shipped --source matte=$M/proposals/matte --compare matte shipped --missing empty --out $M/report
```

Each photo starts from one source's mask, chosen by a fixed hash of the key and not shown, so neither source gets a
systematic head start. Starting from a mask still flatters it (people fix less than they should), so the report also
shows each source's scores on the photos it did **not** start. Seconds and strokes per photo are logged; `score.py` checks
the effort proxy against the owner's real seconds, so the proxy can be trusted or dropped.

Photos the owner marks "can't judge" are left out and listed. Add other sources (a new model, a retuned matte) by writing
their masks into another folder and adding `--source name=DIR`: the same photos, same scorer, same numbers.

## Tests

```bash
cd scripts && python3 -m unittest discover -s maskstick -t . -p 'test_*.py'
```

(or `python -m pytest scripts/maskstick`). They skip themselves if scipy is missing. The baseline runner needs the Kestrel
checkout (`npm ci`) and is exercised by `bench_synth.py`, not by unit tests.

## Do not

Train on, tune against or pick thresholds from the held-out photos or their masks. Use third-party model outputs
(U²-Net-P, BiRefNet, EfficientSAM) as labels. Commit owner photos, previews or masks.
