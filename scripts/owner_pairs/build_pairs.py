#!/usr/bin/env python3
"""Pair the scanned index and write pairs.json + aggregate counts (no file access on the drive)."""
import argparse, json, os, sys
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pairing as P

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); a = ap.parse_args()
    idx = [json.loads(l) for l in open(os.path.join(a.out, 'index.jsonl'))]
    pairs, st = P.pair(idx)
    # One final image per RAW+hash; keep every variant but mark it.
    rows = []
    for p in pairs:
        r, i = p['raw'], p['img']
        rows.append({'status': p['status'], 'reason': p['reason'], 'raw': r['path'], 'raw_hash': r['hash'], 'img': i['path'],
                     'img_hash': i['hash'], 'class': P.classify_image(i), 'crop': P.crop_hint(r, i), 'model': r.get('Model'),
                     'lens': r.get('LensID') or r.get('LensModel'), 'focal': r.get('FocalLength'), 'iso': r.get('ISO'),
                     'et': r.get('ExposureTime'), 'f': r.get('FNumber'), 'ev': r.get('ExposureCompensation'),
                     'img_w': i.get('ImageWidth'), 'img_h': i.get('ImageHeight')})
    json.dump(rows, open(os.path.join(a.out, 'pairs.json'), 'w'))
    c = Counter
    kinds = c(r.get('kind') + ':' + r.get('ext', '') for r in idx)
    print('index kinds', dict(kinds))
    print('cameras (raw)', dict(c(r.get('Model') for r in idx if r.get('kind') == 'raw')))
    print(st, 'pairs', len(rows), dict(c(r['status'] for r in rows)))
    conf = [r for r in rows if r['status'] == 'confident']
    print('confident by class', dict(c(r['class'] for r in conf)))
    print('confident by crop', dict(c(r['crop'] for r in conf)))
    print('confident by model', dict(c(r['model'] for r in conf)))
    print('distinct raws in confident edited pairs', len({r['raw_hash'] for r in conf if r['class'] == 'edited'}))
if __name__ == '__main__':
    main()
