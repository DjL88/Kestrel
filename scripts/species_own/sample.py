#!/usr/bin/env python3
"""Pick a bounded, time-spread sample of the owner's frames for each mapped folder and cache ~512 px previews.

Reads the index built by the owner-pairs tools (no rescan). The drive is only READ. Cache and reports go OUTSIDE Git
(default ~/code/kestrel-test-photos/species-own). Usage: sample.py [--per-folder 80] [--per-species 400]
"""
import argparse, json, os, subprocess, io, hashlib, re, sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.expanduser('~/code/kestrel-test-photos/species-own')
INDEX = os.path.expanduser('~/code/kestrel-test-photos/owner-pairs/index.jsonl')
DRIVE = '/Volumes/D J Leitch Photography/'


def folder_of(path):
    rel = path.replace(DRIVE, '')
    parts = rel.split('/')
    if parts[0] == 'Photos' and len(parts) > 2:
        return parts[1]
    return parts[0]


def evenly(items, n):
    if len(items) <= n:
        return items
    return [items[int(i * len(items) / n)] for i in range(n)]


def shoot_day(rec):
    d = (rec.get('DateTimeOriginal') or '')[:10].replace(':', '-')
    return d if re.match(r'\d{4}-\d\d-\d\d', d) else ''


def load_preview(path, kind):
    if kind == 'img':
        im = Image.open(path)
        im.draft('RGB', (1024, 1024))
    else:
        data = b''
        for tag in ('-JpgFromRaw', '-PreviewImage'):
            data = subprocess.run(['exiftool', '-b', tag, path], capture_output=True).stdout
            if len(data) > 20000:
                break
        if len(data) <= 20000:
            # No usable embedded preview (some NEFs): fall back to the system RAW decoder, slower (seconds a frame)
            import tempfile
            with tempfile.TemporaryDirectory() as tmp:
                dst = os.path.join(tmp, 'p.jpg')
                subprocess.run(['sips', '-s', 'format', 'jpeg', '-Z', '512', path, '--out', dst], capture_output=True)
                im = Image.open(dst)
                im.load()
        else:
            im = Image.open(io.BytesIO(data))
    from PIL import ImageOps
    im = ImageOps.exif_transpose(im).convert('RGB')
    im.thumbnail((512, 512), Image.LANCZOS)
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-folder', type=int, default=80)
    ap.add_argument('--per-species', type=int, default=400)
    ap.add_argument('--out-of-set', type=int, default=40)
    a = ap.parse_args()
    labels = json.load(open(os.path.join(HERE, 'folder-labels.json')))
    want = {}
    for sp, spec in labels['species'].items():
        for f in spec['folders']:
            want[f['folder']] = ('species', sp, f['tier'])
    for kind in ('scenes', 'otherbirds'):
        for f in labels['out_of_set'][kind]:
            want.setdefault(f, ('out_' + kind, 'OUT:' + kind, 'n/a'))
    by_folder = {}
    for line in open(INDEX):
        r = json.loads(line)
        f = folder_of(r['path'])
        if f in want and r['kind'] in ('raw', 'img') and r['ext'] not in ('xmp',):
            by_folder.setdefault(f, []).append(r)
    chosen = []
    for f, recs in by_folder.items():
        recs.sort(key=lambda r: (r.get('DateTimeOriginal') or '', r['path']))
        # one entry per frame stem, JPEG preferred (it is the owner's in-camera or edited look)
        seen = {}
        for r in recs:
            stem = os.path.splitext(r['path'])[0]
            if stem not in seen or (r['kind'] == 'img' and seen[stem]['kind'] != 'img'):
                seen[stem] = r
        uniq = list(seen.values())
        cap = a.out_of_set if want[f][0] != 'species' else a.per_folder
        # Spread over each shooting day so bursts of near-identical frames do not dominate
        days = {}
        for r in uniq:
            days.setdefault(shoot_day(r), []).append(r)
        per_day = max(1, cap // max(1, len(days)))
        for d, rs in days.items():
            for r in evenly(rs, per_day):
                chosen.append((f, d, r))
    # species cap
    out = []
    bysp = {}
    for f, d, r in chosen:
        bysp.setdefault(want[f][1], []).append((f, d, r))
    for sp, items in bysp.items():
        cap = a.per_species if not sp.startswith('OUT:') else 10_000
        out.extend(evenly(items, cap))
    os.makedirs(os.path.join(OUT, 'previews'), exist_ok=True)
    rows = []

    def work(item):
        f, d, r = item
        key = hashlib.sha1(r['path'].encode()).hexdigest()[:16]
        dst = os.path.join(OUT, 'previews', key + '.jpg')
        ok = True
        if not os.path.exists(dst):
            try:
                load_preview(r['path'], r['kind']).save(dst, quality=85)
            except Exception as e:  # keep going; record the failure
                ok = False
                sys.stderr.write(f'FAIL {r["path"]}: {e}\n')
        return dict(id=key, folder=f, species=want[f][1], set=want[f][0], tier=want[f][2], day=d,
                    kind=r['kind'], ext=r['ext'], ok=ok, camera=r.get('Model'), name=os.path.basename(r['path']))

    with ThreadPoolExecutor(4) as ex:
        for row in ex.map(work, out):
            rows.append(row)
    with open(os.path.join(OUT, 'sample.jsonl'), 'w') as fh:
        for row in rows:
            fh.write(json.dumps(row) + '\n')
    print(len(rows), 'rows', sum(1 for r in rows if not r['ok']), 'failed')


if __name__ == '__main__':
    main()
