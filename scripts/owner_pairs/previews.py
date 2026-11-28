#!/usr/bin/env python3
"""Small previews for confident pairs, written ONLY under --out (never the drive).

RAW side: the camera's embedded JPEG (exiftool -b, read-only) = the camera-default render.
Final side: the owner's JPEG downscaled. Long edge <= 1024, quality 80.
"""
import argparse, io, json, os, subprocess, sys
from PIL import Image, ImageOps

def save_small(im, path, edge=1024):
    im = ImageOps.exif_transpose(im).convert('RGB')
    im.thumbnail((edge, edge), Image.LANCZOS)
    im.save(path, 'JPEG', quality=80)
    return im.size

def raw_embedded(path):
    for tag in ('-JpgFromRaw', '-PreviewImage', '-OtherImage'):
        b = subprocess.run(['exiftool', '-b', tag, path], capture_output=True, timeout=120, stdin=subprocess.DEVNULL).stdout
        if len(b) > 20000:
            return Image.open(io.BytesIO(b))
    return None

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True)
    ap.add_argument('--classes', default='edited'); ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    pairs = json.load(open(os.path.join(a.out, 'pairs.json')))
    want = [p for p in pairs if p['status'] == 'confident' and p['class'] in a.classes.split(',')]
    d = os.path.join(a.out, 'previews'); os.makedirs(d, exist_ok=True)
    done = 0
    for p in want:
        key = p['raw_hash'] + '_' + p['img_hash']
        fr, ff = os.path.join(d, key + '_raw.jpg'), os.path.join(d, key + '_final.jpg')
        if os.path.exists(fr) and os.path.exists(ff): continue
        try:
            e = raw_embedded(p['raw'])
            if e is None: continue
            f = Image.open(p['img']); f.draft('RGB', (2048, 2048))
            save_small(e, fr); save_small(f, ff)
        except Exception as ex:
            print('skip', key, ex); continue
        done += 1
        if done % 50 == 0: print(done, '/', len(want), flush=True)
        if a.limit and done >= a.limit: break
    print('done', done)
if __name__ == '__main__':
    main()
