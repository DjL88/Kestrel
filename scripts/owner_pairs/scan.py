#!/usr/bin/env python3
"""Read-only EXIF index of a photo drive. Resumable, one directory at a time.

SAFETY: files on the drive are only ever opened 'rb' (and read by exiftool,
which never writes unless asked). Output goes to --out (outside the repo).

  python3 -I scripts/owner_pairs/scan.py --root "/Volumes/..." --out ~/code/kestrel-test-photos/owner-pairs
"""
import argparse, hashlib, json, os, subprocess, sys, time

RAW_EXT = {'nef', 'nrw', 'cr2', 'cr3', 'arw', 'raf', 'orf', 'rw2', 'dng', 'pef', 'srw'}
IMG_EXT = {'jpg', 'jpeg', 'tif', 'tiff', 'hif', 'heic', 'png', 'webp'}
SKIP_DIRS = {'$RECYCLE.BIN', 'System Volume Information'}
TAGS = ['-Make', '-Model', '-LensID', '-LensModel', '-DateTimeOriginal', '-SubSecTimeOriginal',
        '-OffsetTimeOriginal', '-ISO', '-ExposureTime', '-FNumber', '-ExposureCompensation',
        '-ImageWidth', '-ImageHeight', '-ExifImageWidth', '-ExifImageHeight', '-Orientation',
        '-Software', '-CreatorTool', '-ShutterCount', '-ImageUniqueID', '-SerialNumber',
        '-ProfileDescription', '-FocalLength', '-WhiteBalance', '-PictureControlName',
        '-FileType', '-FileSize#', '-SourceFile']

def ext_of(name):
    return name.rsplit('.', 1)[-1].lower() if '.' in name else ''

def quick_hash(path, size):
    """sha1 of size + first 64 KiB + last 64 KiB (read-only)."""
    h = hashlib.sha1(str(size).encode())
    with open(path, 'rb') as f:
        h.update(f.read(65536))
        if size > 131072:
            f.seek(size - 65536)
            h.update(f.read(65536))
    return h.hexdigest()[:20]

def list_dirs(root):
    for dp, dns, fns in os.walk(root):
        dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not d.startswith('.'))
        yield dp, fns

def classify(ext):
    if ext in RAW_EXT: return 'raw'
    if ext in IMG_EXT: return 'img'
    return None

def scan_dir(dp, fns):
    files = [os.path.join(dp, f) for f in sorted(fns) if not f.startswith('.') and classify(ext_of(f))]
    if not files: return []
    out = []
    for i in range(0, len(files), 200):
        chunk = files[i:i + 200]
        rows = []
        for sub in (chunk[j:j + 25] for j in range(0, len(chunk), 25)):
            try:
                r = subprocess.run(['exiftool', '-json', '-n', '-q', '-m', '-fast2'] + TAGS + sub,
                                   capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
                rows += json.loads(r.stdout or '[]')
            except (subprocess.TimeoutExpired, json.JSONDecodeError):
                print('exiftool problem in batch, files kept without EXIF', flush=True)
        by = {row['SourceFile']: row for row in rows}
        for p in chunk:
            row = by.get(p, {})
            row.pop('SourceFile', None)
            try:
                size = os.path.getsize(p)
                row['hash'] = quick_hash(p, size)
            except OSError as e:
                row['error'] = str(e)
            row['path'] = p
            row['kind'] = classify(ext_of(p))
            row['ext'] = ext_of(p)
            out.append(row)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    idx, done_f = os.path.join(a.out, 'index.jsonl'), os.path.join(a.out, 'scan-done.txt')
    done = set(open(done_f).read().split('\n')) if os.path.exists(done_f) else set()
    n = 0; t0 = time.time()
    with open(idx, 'a') as fi, open(done_f, 'a') as fd:
        for dp, fns in list_dirs(a.root):
            if dp in done: continue
            rows = scan_dir(dp, fns)
            for r in rows: fi.write(json.dumps(r, ensure_ascii=False) + '\n')
            fi.flush(); fd.write(dp + '\n'); fd.flush()
            n += len(rows)
            if rows: print(f'{n} files, {time.time()-t0:.0f}s  {os.path.basename(dp)}', flush=True)

if __name__ == '__main__':
    main()
