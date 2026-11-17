# Using your own photos and Lightroom catalog, without uploading anything

Two small tools run on your own computer and write only small results. The photos and the catalog stay where they are.
Neither tool changes, moves or sends a file. Both work on Windows, macOS and Linux.

## 1. Prepare RAW files for training (and measure each camera's real noise)

Needs Python 3.9 or newer.

```powershell
git clone https://github.com/DjL88/Kestrel
cd Kestrel
python -m venv tools\denoise-training\.venv
tools\denoise-training\.venv\Scripts\pip install numpy rawpy exifread

# try 100 files first
tools\denoise-training\.venv\Scripts\python tools\denoise-training\prepare_crops.py "D:\Photos" prepared --limit 100

# then all of them (it can be stopped and run again; finished files are skipped)
tools\denoise-training\.venv\Scripts\python tools\denoise-training\prepare_crops.py "D:\Photos" prepared
```

On macOS or Linux use `python3`, `.venv/bin/pip` and `.venv/bin/python`.

What you get in `prepared`:

- `crops-0000.npz`, ...: a few small sensor crops per photo (4 per file by default), with ISO and camera.
- `files.jsonl`: one line per RAW with camera, ISO, and its measured noise. File names appear only with their size.
- `noise_profile.json`: the median measured noise for each camera and ISO, from your own files. This is what calibrates
  the training noise to your real bodies.

Roughly 10,000 files give a few GB of crops at the default of 4 per file; use `--crops 1` for a smaller set. Nikon High
Efficiency (HE and HE*) files cannot be read by this tool and are skipped with a note; lossless and compressed NEFs work.

Only run the 100-file test and send `noise_profile.json` and `files.jsonl` first. They are tiny and tell us whether the
measured noise looks right before anything bigger is copied.

## 2. Read your Lightroom edits

```powershell
python tools\lightroom\read_lrcat.py "C:\Users\you\Pictures\Lightroom\Lightroom Catalog.lrcat" recipes.jsonl --no-paths
```

Close Lightroom first, or point it at a copy of the catalog. It opens the catalog read-only, so the catalog cannot be
changed. `--no-paths` replaces file paths with short hashes. It writes `recipes.jsonl` (one line per photo) and
`recipes.summary.json` (how much noise reduction, exposure and sharpening you chose at each ISO band).

The table layout it expects is from how Lightroom Classic catalogs are generally organised, and has not been checked
against a real one. If your catalog differs the tool says which table or column is missing; run it with `--schema` and
share the listing so it can be adapted.

What it cannot do: reproduce Lightroom's rendering. The catalog stores settings, not pixels. If your exported JPEGs are
still on disk they can be matched to the RAWs by name to learn the overall look.

## If Claude is installed on that computer

Open the cloned `Kestrel` folder in Claude and ask it to run the steps above and to read `noise_profile.json` back to
you. It can check the output for problems before you copy anything. Nothing here needs it to see the photos themselves.
