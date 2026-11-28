"""Match finished JPEG/TIFF files to their RAWs by EXIF (never by file name).

Pure functions over index rows (dicts from scan.py). No file access.
"""
import re
from collections import defaultdict
from datetime import datetime

EDITOR_RE = re.compile(r'lightroom|photoshop|camera raw|capture one|dxo|affinity|luminar|on1|darktable|rawtherapee|gimp|snapseed|nik |topaz', re.I)
APP_RE = re.compile(r'kestrel|inflight', re.I)
CAMERA_FW_RE = re.compile(r'^(ver\.?\s?[\d.]+|[a-z0-9 ]+ ver\.?\s?[\d.]+|firmware|nikon|canon|sony|fujifilm|olympus|om system|panasonic)', re.I)


def capture_key(row):
    """Capture time as float seconds (naive local clock) with sub-second part, or None."""
    t = row.get('DateTimeOriginal')
    if not t:
        return None
    try:
        dt = datetime.strptime(str(t)[:19], '%Y:%m:%d %H:%M:%S')
    except ValueError:
        return None
    sub = str(row.get('SubSecTimeOriginal', '') or '').strip()
    frac = float('0.' + sub) if sub.isdigit() else 0.0
    return dt.timestamp() + frac


def close(a, b, rel):
    if a is None or b is None:
        return True  # unknown is not a mismatch
    return abs(a - b) <= rel * max(abs(a), abs(b), 1e-9)


def settings_match(raw, img):
    if raw.get('Model') != img.get('Model'):
        return False
    if raw.get('ISO') is not None and img.get('ISO') is not None and raw['ISO'] != img['ISO']:
        return False
    if not close(raw.get('ExposureTime'), img.get('ExposureTime'), 0.02):
        return False
    if not close(raw.get('FNumber'), img.get('FNumber'), 0.03):
        return False
    return True


def classify_image(row):
    """'app-export' | 'edited' | 'camera' | 'unknown'. Camera JPEGs carry only firmware in Software."""
    sw = ' '.join(str(row.get(k, '') or '') for k in ('Software', 'CreatorTool'))
    if APP_RE.search(sw):
        return 'app-export'
    if EDITOR_RE.search(sw):
        return 'edited'
    if not sw.strip() or CAMERA_FW_RE.search(sw.strip()):
        return 'camera'
    return 'unknown'


def dedupe_raws(raws):
    """One entry per distinct file content (same hash found in several folders = one RAW)."""
    seen = {}
    for r in raws:
        seen.setdefault(r.get('hash') or r['path'], r)
    return list(seen.values())


def pair(index, window=1.5):
    """Return (pairs, stats). Each pair: {raw, img, status: 'confident'|'uncertain', reason}."""
    raws = dedupe_raws([r for r in index if r.get('kind') == 'raw' and capture_key(r) is not None])
    imgs = [r for r in index if r.get('kind') == 'img' and r.get('ext') in ('jpg', 'jpeg', 'tif', 'tiff', 'hif', 'heic') and capture_key(r) is not None]
    by_time = defaultdict(list)
    for r in raws:
        by_time[int(capture_key(r))].append(r)
    pairs, seen_img = [], set()
    for im in imgs:
        k = capture_key(im)
        cands = []
        for s in range(int(k) - 2, int(k) + 3):
            for r in by_time.get(s, ()):
                if abs(capture_key(r) - k) <= window and settings_match(r, im):
                    cands.append(r)
        if not cands:
            continue
        # sub-second exact match narrows burst candidates
        exact = [r for r in cands if abs(capture_key(r) - k) < 0.005]
        pool = exact or cands
        if len(pool) == 1:
            pairs.append({'raw': pool[0], 'img': im, 'status': 'confident', 'reason': 'time+body+settings'})
        else:
            pairs.append({'raw': pool[0], 'img': im, 'status': 'uncertain', 'reason': f'{len(pool)} raws share the capture time (burst)'})
    # A RAW claimed by raws with an identical key but different content is a burst too.
    key_count = defaultdict(int)
    for r in raws:
        key_count[(r.get('Model'), round(capture_key(r), 2))] += 1
    for p in pairs:
        r = p['raw']
        if p['status'] == 'confident' and key_count[(r.get('Model'), round(capture_key(r), 2))] > 1:
            p['status'], p['reason'] = 'uncertain', 'another raw has the identical capture time'
    return pairs, {'raws': len(raws), 'images_with_time': len(imgs)}


def crop_hint(raw, img):
    """Compare aspect/size: 'same' | 'resized' | 'cropped' | 'rotated' | 'unknown'."""
    def dims(r):
        w = r.get('ExifImageWidth') or r.get('ImageWidth'); h = r.get('ExifImageHeight') or r.get('ImageHeight')
        return (w, h) if w and h else None
    a, b = dims(raw), dims(img)
    if not a or not b:
        return 'unknown'
    ar, br = a[0] / a[1], b[0] / b[1]
    if abs(ar - br) < 0.01:
        return 'same' if abs(a[0] - b[0]) < 4 else 'resized'
    if abs(ar - 1 / br) < 0.01:
        return 'rotated'
    return 'cropped'
