#!/usr/bin/env python3
"""Downloads the offline vision models named in manifest.json, verified, into a local store. Nothing is put in git.

  python3 scripts/models/acquire.py --dest ~/kestrel-models --models smolvlm2-500m florence-2-base --quant int8

Every file is fetched from the pinned revision, resumed if interrupted, checked against the manifest (SHA-256 for large
files, git blob id for small ones) and only then moved into place. A mismatch deletes the partial file and stops: a
corrupt or substituted model is never installed. Existing files that already verify are left alone, so a rerun is cheap
and the previous working model is never touched. Attribution is written beside the files.
"""
import argparse, hashlib, json, os, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CHUNK = 1 << 20

def git_blob_id(path: Path) -> str:
    size = path.stat().st_size
    digest = hashlib.sha1(f'blob {size}\0'.encode())
    with open(path, 'rb') as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()

def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()

def verifies(path: Path, entry: dict) -> bool:
    if not path.is_file() or path.stat().st_size != entry['bytes']:
        return False
    return sha256_of(path) == entry['sha256'] if 'sha256' in entry else git_blob_id(path) == entry['gitBlob']

def download(url: str, part: Path, expected: int) -> None:
    """Streams to `part`, resuming from what is already there."""
    have = part.stat().st_size if part.exists() else 0
    if have > expected:
        part.unlink(); have = 0
    request = urllib.request.Request(url, headers={'User-Agent': 'kestrel-model-acquire', **({'Range': f'bytes={have}-'} if have else {})})
    with urllib.request.urlopen(request, timeout=60) as response:
        if have and response.status != 206:      # the server ignored Range: start again
            part.unlink(); have = 0
        with open(part, 'ab' if have else 'wb') as out:
            while chunk := response.read(CHUNK):
                out.write(chunk)

def fetch_model(key: str, model: dict, dest: Path, quants: list[str], base_url: str) -> list[str]:
    root = dest / key / model['revision'][:12]
    root.mkdir(parents=True, exist_ok=True)
    installed = []
    for entry in model['files']:
        name = entry['path']
        # Keep the shared small files and only the quantisations asked for.
        if name.startswith('onnx/') and not any(name.endswith(f'_{q}.onnx') for q in quants):
            continue
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if verifies(target, entry):
            installed.append(name); continue
        part = target.with_name(target.name + '.part')
        download(f"{base_url}/{model['repo']}/resolve/{model['revision']}/{name}", part, entry['bytes'])
        if not verifies(part, entry):
            part.unlink(missing_ok=True)
            raise SystemExit(f'{key}/{name}: the downloaded file does not match the manifest. Nothing was installed for it.')
        os.replace(part, target)
        installed.append(name)
    (root / 'NOTICE.txt').write_text(
        f"{model['repo']} @ {model['revision']}\nLicence: {model['license']} ({model['licenseSource']})\n"
        f"Source: {model['url']}\nRole in Kestrel: {model['role']}\n"
        'Kept unmodified, checked against the SHA-256 or git blob id recorded in scripts/models/manifest.json.\n')
    return installed

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dest', required=True, type=Path)
    ap.add_argument('--models', nargs='+', default=['smolvlm2-500m', 'florence-2-base'])
    ap.add_argument('--quant', nargs='+', default=['int8'], choices=['int8', 'q4'])
    ap.add_argument('--manifest', type=Path, default=HERE / 'manifest.json')
    ap.add_argument('--base-url', default='https://huggingface.co')
    ap.add_argument('--dry-run', action='store_true', help='list what would be downloaded and its size')
    args = ap.parse_args(argv)
    manifest = json.loads(args.manifest.read_text())
    for key in args.models:
        if key not in manifest['models']:
            sys.exit(f'unknown model {key}; known: {", ".join(manifest["models"])}')
        model = manifest['models'][key]
        if args.dry_run:
            size = sum(f['bytes'] for f in model['files'] if not f['path'].startswith('onnx/') or any(f['path'].endswith(f'_{q}.onnx') for q in args.quant))
            print(f"{key}: {model['license']}, {size / 1e6:.0f} MB for {', '.join(args.quant)}")
            continue
        done = fetch_model(key, model, args.dest.expanduser(), args.quant, args.base_url)
        print(f'{key}: {len(done)} files verified in {args.dest.expanduser() / key / model["revision"][:12]}')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
