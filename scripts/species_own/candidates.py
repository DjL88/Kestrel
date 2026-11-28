#!/usr/bin/env python3
"""Labelling-candidates report for the OWNER to confirm: species, folders, counts, and a contact sheet per species.
Everything is written outside Git (default ~/code/kestrel-test-photos/species-own). Nothing is trained on a row until the
owner sets confirmed: true for it in the reviewed copy of folder-labels.json.
"""
import collections, json, os, random
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.expanduser('~/code/kestrel-test-photos/species-own')
INDEX = os.path.expanduser('~/code/kestrel-test-photos/owner-pairs/index.jsonl')
DRIVE = '/Volumes/D J Leitch Photography/'
T = 128


def folder_of(path):
    parts = path.replace(DRIVE, '').split('/')
    return parts[1] if parts[0] == 'Photos' and len(parts) > 2 else parts[0]


def sheet(rows, title, path, cols=10, n=60):
    rng = random.Random(7)
    pick = sorted(rng.sample(rows, min(n, len(rows))), key=lambda r: (r['folder'], r['day'], r['name']))
    rws = (len(pick) + cols - 1) // cols
    im = Image.new('RGB', (cols * T, rws * (T + 14) + 20), (24, 24, 24))
    d = ImageDraw.Draw(im)
    d.text((4, 4), title, fill=(230, 230, 230))
    for i, r in enumerate(pick):
        p = os.path.join(OUT, 'previews', r['id'] + '.jpg')
        if not os.path.exists(p):
            continue
        t = Image.open(p); t.thumbnail((T, T))
        x, y = (i % cols) * T, 20 + (i // cols) * (T + 14)
        im.paste(t, (x, y))
        d.text((x + 2, y + T), (r['folder'][:18]), fill=(160, 160, 160))
    im.save(path, quality=80)


def main():
    labels = json.load(open(os.path.join(HERE, 'folder-labels.json')))
    rows = [json.loads(l) for l in open(os.path.join(OUT, 'sample.jsonl'))]
    counts = collections.defaultdict(lambda: collections.Counter())
    for l in open(INDEX):
        r = json.loads(l)
        counts[folder_of(r['path'])][r['kind']] += 1
    md = ['# Species labelling candidates: please confirm or correct', '',
          'Weak labels from your own folder names. **Nothing is trained for release until you confirm each row.** '
          'Thumbnail sheets (outside Git) are in `sheets/`. Mark a folder wrong, mixed or unsure and it is dropped.', '']
    os.makedirs(os.path.join(OUT, 'sheets'), exist_ok=True)
    for sp, spec in labels['species'].items():
        sr = [r for r in rows if r['species'] == sp]
        md += [f"## {sp} ({spec['scientific']}): {len(sr)} sampled frames ({sum(1 for r in sr if r['ok'])} usable)", '',
               '| Folder | name tier | RAW | JPEG | sampled | shoot days | ok? |', '|---|---|---|---|---|---|---|']
        for f in spec['folders']:
            fr = [r for r in sr if r['folder'] == f['folder']]
            c = counts.get(f['folder'], {})
            days = sorted({r['day'] or '(none)' for r in fr})
            md.append(f"| {f['folder']} | {f['tier']} | {c.get('raw', 0)} | {c.get('img', 0)} | {len(fr)} | {', '.join(days)} | [ ] |")
        md.append('')
        if sr:
            sheet([r for r in sr if r['ok']], sp, os.path.join(OUT, 'sheets', sp.replace(' ', '_') + '.jpg'))
            md += [f"Sheet: `sheets/{sp.replace(' ', '_')}.jpg`", '']
    md += ['## Left out on purpose', '']
    md += [f'- **{k}**: {v}' for k, v in labels['not_labelled_on_purpose'].items()]
    md += ['', '## Out-of-set frames (used only to measure false names)', '']
    for g in sorted({r['species'] for r in rows if r['set'] != 'species'}):
        gr = [r for r in rows if r['species'] == g and r['ok']]
        md.append(f'- {g}: {len(gr)} frames from ' + ', '.join(sorted({r['folder'] for r in gr})))
        sheet(gr, g, os.path.join(OUT, 'sheets', g.replace(':', '_') + '.jpg'))
    bad = [r for r in rows if not r['ok']]
    md += ['', f'## Unreadable frames: {len(bad)}', 'No embedded preview and the system decoder failed: ' + ', '.join(sorted({r["folder"] for r in bad}))]
    open(os.path.join(OUT, 'candidates.md'), 'w').write('\n'.join(md))
    print('\n'.join(md[:40]))


if __name__ == '__main__':
    main()
