"""Blind side-by-side comparison of finished photos from several editors (InFlight, DxO, Lightroom, Topaz...).

Finish-line jobs x-gap-benchmark, p3-maskdenoise and x-uat-highiso; how to run it: docs/QUALITY-BENCHMARKS.md.

    python scripts/blind_compare.py make shoot.json out/      # 100% crops, shuffled, and a page to judge them
    (open out/judge.html, pick the best and the worst crop in each row, press "Save my choices")
    python scripts/blind_compare.py score out/key.json picks.json > results.md

Each editor's export is cropped at the same place (eye, feather, background...) at 100%, the crops are shown under
random letters in a random order per row, and the key that says which letter is which editor stays in key.json, which
judge.html never reads. The page shows no file names, sizes or metadata. Scoring reports wins and losses exactly as
picked, plus two measurements per crop (fine-detail energy and background noise). The measurements describe pixels;
they do not prove real detail, since a sharpened or invented texture also scores as detail. Wins, losses and
measurements are reported side by side, never as a claim of parity. Originals and exports are only read.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image

MAX_EDITORS = 8
MAX_CROP = 1200


def load_rgb(path: Path) -> np.ndarray:
    """RGB as float32 0..1, from an 8- or 16-bit TIFF, JPEG or PNG."""
    if path.suffix.lower() in ('.tif', '.tiff'):
        try:
            import tifffile
            data = tifffile.imread(str(path))
            if data.ndim == 3 and data.shape[0] in (3, 4) and data.shape[-1] not in (3, 4):
                data = np.moveaxis(data, 0, -1)
            data = data[..., :3] if data.ndim == 3 else np.repeat(data[..., None], 3, axis=2)
            scale = 65535.0 if data.dtype == np.uint16 else 255.0 if data.dtype == np.uint8 else 1.0
            return np.clip(data.astype(np.float32) / scale, 0, 1)
        except ImportError:
            pass
    with Image.open(path) as image:
        return np.asarray(image.convert('RGB'), dtype=np.float32) / 255.0


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def crop_metrics(rgb: np.ndarray) -> dict:
    """Detail: mean neighbour difference. Noise: robust spread of a 3x3 high-pass (median absolute deviation)."""
    luma = luminance(rgb)
    gradients = np.concatenate((np.abs(np.diff(luma, axis=1)).ravel(), np.abs(np.diff(luma, axis=0)).ravel()))
    padded = np.pad(luma, 1, mode='edge')
    blur = sum(padded[dy:dy + luma.shape[0], dx:dx + luma.shape[1]] for dy in range(3) for dx in range(3)) / 9.0
    high = luma - blur
    return {
        'detail': round(float(gradients.mean()), 6),
        'noise': round(float(1.4826 * np.median(np.abs(high - np.median(high)))), 6),
        'mean_luminance': round(float(luma.mean()), 4),
    }


def _region(value, label: str) -> tuple[int, int, int, int]:
    if not (isinstance(value, list) and len(value) == 4 and all(isinstance(v, int) for v in value)):
        raise ValueError(f'{label}: region must be [x, y, width, height] in pixels of the first editor\'s export')
    x, y, w, h = value
    if x < 0 or y < 0 or w < 16 or h < 16 or w > MAX_CROP or h > MAX_CROP:
        raise ValueError(f'{label}: region must be inside the photo and 16 to {MAX_CROP} pixels across')
    return x, y, w, h


def load_shoot(path: Path) -> dict:
    shoot = json.loads(path.read_text(encoding='utf-8'))
    frames = shoot.get('frames') if isinstance(shoot, dict) else None
    if not isinstance(frames, list) or not frames:
        raise ValueError('shoot.json needs a "frames" list')
    seen = set()
    for frame in frames:
        fid = frame.get('id') if isinstance(frame, dict) else None
        if not isinstance(fid, str) or not fid.strip() or fid in seen:
            raise ValueError('every frame needs its own "id"')
        seen.add(fid)
        outputs = frame.get('outputs')
        if not isinstance(outputs, dict) or not 2 <= len(outputs) <= MAX_EDITORS:
            raise ValueError(f'{fid}: "outputs" must name 2 to {MAX_EDITORS} editors and their exported files')
        regions = frame.get('regions')
        if not isinstance(regions, dict) or not regions:
            raise ValueError(f'{fid}: "regions" must name at least one crop, such as "eye"')
        for name, value in regions.items():
            _region(value, f'{fid} {name}')
        for editor, file in outputs.items():
            if not isinstance(file, str) or not (path.parent / file).is_file():
                raise ValueError(f'{fid}: the {editor} export is missing')
    return shoot


def make(shoot_path: Path, out: Path, seed: int | None = None) -> dict:
    shoot = load_shoot(shoot_path)
    rng = random.Random(seed if seed is not None else random.SystemRandom().randrange(1 << 30))
    out.mkdir(parents=True, exist_ok=True)
    (out / 'crops').mkdir(exist_ok=True)
    rows, key = [], {'rows': {}, 'note': 'Do not open while judging. Opened only by "score".'}
    for frame in shoot['frames']:
        images = {editor: load_rgb(shoot_path.parent / file) for editor, file in frame['outputs'].items()}
        first = next(iter(images.values()))
        fh, fw = first.shape[:2]
        for region, value in frame['regions'].items():
            x, y, w, h = _region(value, f"{frame['id']} {region}")
            if x + w > fw or y + h > fh:
                raise ValueError(f"{frame['id']} {region}: region is outside the photo")
            editors = list(images)
            rng.shuffle(editors)
            row_id = f'r{len(rows) + 1:03d}'
            letters, metrics = {}, {}
            for index, editor in enumerate(editors):
                image = images[editor]
                ih, iw = image.shape[:2]
                if abs(iw / ih - fw / fh) > 0.01:
                    raise ValueError(f"{frame['id']}: the {editor} export has a different shape (was it cropped?)")
                # The same place in each export; an export of another size is cropped at the same relative place and
                # shown at the same size, so every crop is seen at the same physical scale.
                sx, sy = iw / fw, ih / fh
                crop = image[round(y * sy):round((y + h) * sy), round(x * sx):round((x + w) * sx)]
                pixels = Image.fromarray(np.clip(crop * 255 + 0.5, 0, 255).astype(np.uint8))
                if pixels.size != (w, h):
                    pixels = pixels.resize((w, h), Image.LANCZOS)
                letter = chr(ord('A') + index)
                name = hashlib.sha256(f'{row_id}{letter}{rng.random()}'.encode()).hexdigest()[:16] + '.png'
                pixels.save(out / 'crops' / name)
                letters[letter] = {'editor': editor, 'file': name}
                metrics[editor] = crop_metrics(np.asarray(pixels, dtype=np.float32) / 255.0)
            rows.append({'row': row_id, 'region': region, 'crops': [{'letter': l, 'file': v['file']} for l, v in letters.items()]})
            key['rows'][row_id] = {'frame': frame['id'], 'region': region,
                                   'letters': {l: v['editor'] for l, v in letters.items()}, 'metrics': metrics}
    rng.shuffle(rows)
    (out / 'key.json').write_text(json.dumps(key, indent=1), encoding='utf-8')
    (out / 'judge.html').write_text(judge_page(rows), encoding='utf-8')
    return key


def judge_page(rows: list[dict]) -> str:
    """A plain page: each row shows the crops under letters only; the choices are saved as picks.json."""
    body = []
    for number, row in enumerate(rows, 1):
        crops = ''.join(
            f'<figure><img src="crops/{html.escape(c["file"])}" alt="Crop {c["letter"]}"><figcaption>{c["letter"]}'
            f'<label><input type="radio" name="{row["row"]}-best" value="{c["letter"]}"> Best</label>'
            f'<label><input type="radio" name="{row["row"]}-worst" value="{c["letter"]}"> Worst</label></figcaption></figure>'
            for c in row['crops'])
        body.append(f'<section data-row="{row["row"]}"><h2>{number} of {len(rows)}: {html.escape(row["region"])}</h2>'
                    f'<div class="crops">{crops}</div></section>')
    return f'''<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blind comparison</title><style>
body{{font:16px system-ui,sans-serif;margin:16px;background:#222;color:#eee}} .crops{{display:flex;flex-wrap:wrap;gap:12px}}
figure{{margin:0}} img{{display:block;image-rendering:pixelated;max-width:100%}} figcaption{{display:flex;gap:12px;padding:6px 0;font-weight:700}}
label{{font-weight:400}} button{{font:inherit;padding:8px 16px;margin:16px 0}} section{{border-top:1px solid #555;padding:8px 0}}
</style></head><body><h1>Blind comparison</h1>
<p>Each row is the same part of one photo from different editors, at 100%. Letters change from row to row. Pick the best
and, if one stands out, the worst. Judge detail, noise, smears and halos; leave a row blank if you cannot tell.</p>
{''.join(body)}
<button type="button" id="save">Save my choices</button>
<script>
document.getElementById('save').addEventListener('click', () => {{
  const picks = {{}};
  document.querySelectorAll('section[data-row]').forEach((section) => {{
    const row = section.dataset.row;
    const best = section.querySelector(`input[name="${{row}}-best"]:checked`);
    const worst = section.querySelector(`input[name="${{row}}-worst"]:checked`);
    picks[row] = {{ best: best ? best.value : null, worst: worst ? worst.value : null }};
  }});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(picks, null, 1)], {{ type: 'application/json' }}));
  link.download = 'picks.json';
  link.click();
}});
</script></body></html>
'''


def score(key: dict, picks: dict) -> dict:
    editors = sorted({e for row in key['rows'].values() for e in row['letters'].values()})
    table = {e: {'shown': 0, 'best': 0, 'worst': 0, 'by_region': {}} for e in editors}
    judged = skipped = 0
    for row_id, row in key['rows'].items():
        pick = picks.get(row_id) or {}
        best, worst = pick.get('best'), pick.get('worst')
        if best is not None and best == worst:
            raise ValueError(f'{row_id}: the same crop cannot be both best and worst')
        for letter, editor in row['letters'].items():
            table[editor]['shown'] += 1
            region = table[editor]['by_region'].setdefault(row['region'], {'shown': 0, 'best': 0, 'worst': 0})
            region['shown'] += 1
            for kind, chosen in (('best', best), ('worst', worst)):
                if chosen == letter:
                    table[editor][kind] += 1
                    region[kind] += 1
        if best is None and worst is None:
            skipped += 1
        else:
            judged += 1
    metrics = {}
    for row in key['rows'].values():
        for editor, values in row['metrics'].items():
            entry = metrics.setdefault(editor, {}).setdefault(row['region'], {'detail': [], 'noise': []})
            entry['detail'].append(values['detail'])
            entry['noise'].append(values['noise'])
    medians = {e: {r: {k: round(float(np.median(v)), 6) for k, v in m.items()} for r, m in regions.items()} for e, regions in metrics.items()}
    return {'rows': len(key['rows']), 'judged': judged, 'skipped': skipped, 'editors': table, 'median_metrics': medians}


def report_markdown(result: dict) -> str:
    lines = [f"Blind comparison: {result['judged']} rows judged, {result['skipped']} left blank, of {result['rows']}.", '',
             '| Editor | Shown | Picked best | Picked worst |', '|---|---|---|---|']
    for editor, row in result['editors'].items():
        lines.append(f"| {editor} | {row['shown']} | {row['best']} | {row['worst']} |")
    lines += ['', 'By region (best / worst / shown):', '']
    for editor, row in result['editors'].items():
        parts = [f"{region} {v['best']}/{v['worst']}/{v['shown']}" for region, v in sorted(row['by_region'].items())]
        lines.append(f"- {editor}: {', '.join(parts)}")
    lines += ['', 'Median measurements per region (detail: higher is more fine contrast; noise: lower is smoother).',
              'Measurements do not prove real detail: sharpening and invented texture also raise detail.', '',
              '| Editor | Region | Detail | Noise |', '|---|---|---|---|']
    for editor, regions in result['median_metrics'].items():
        for region, values in sorted(regions.items()):
            lines.append(f"| {editor} | {region} | {values['detail']} | {values['noise']} |")
    return '\n'.join(lines) + '\n'


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    m = sub.add_parser('make')
    m.add_argument('shoot', type=Path)
    m.add_argument('out', type=Path)
    m.add_argument('--seed', type=int)
    s = sub.add_parser('score')
    s.add_argument('key', type=Path)
    s.add_argument('picks', type=Path)
    s.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.command == 'make':
            key = make(args.shoot, args.out, args.seed)
            print(f"{len(key['rows'])} rows written to {args.out / 'judge.html'}. Do not open key.json until you have judged.")
        else:
            result = score(json.loads(args.key.read_text(encoding='utf-8')), json.loads(args.picks.read_text(encoding='utf-8')))
            print(json.dumps(result, indent=1) if args.json else report_markdown(result))
    except (OSError, ValueError, KeyError) as error:
        print(f'blind_compare: {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
