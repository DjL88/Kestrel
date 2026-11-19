#!/usr/bin/env python3
"""Offline owner-fixture HE decode evidence runner; never certifies colour or CFA equality."""
import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

ROW = re.compile(r'^([^/\\|]+\.nef) \| (nikon-he(?:-star)?) \| ([1-9][0-9]*)x([1-9][0-9]*) \| ([0-9]+(?:\.[0-9]+)?(?:ms|s))$', re.I)
COUNT = re.compile(r'^High Efficiency files decoded from sensor data: ([0-9]+)$')

def parse_output(output):
    rows, counts = [], []
    for line in output.splitlines():
        line = line.strip()
        match = ROW.fullmatch(line)
        if match:
            path, decoder, width, height, elapsed = match.groups()
            rows.append((Path(path).name, decoder.lower(), int(width), int(height), elapsed))
        count = COUNT.fullmatch(line)
        if count:
            counts.append(int(count.group(1)))
    if len(counts) != 1 or counts[0] == 0 or counts[0] != len(rows):
        raise ValueError('native test did not prove a nonzero, complete HE decode count')
    if len({r[0].casefold() for r in rows}) != len(rows):
        raise ValueError('ambiguous duplicate NEF basenames')
    return rows

def collect(folder, tauri, runner=subprocess.run):
    folder = Path(folder).resolve(strict=True)
    tauri = Path(tauri).resolve(strict=True)
    if not folder.is_dir() or not (tauri / 'Cargo.toml').is_file():
        raise ValueError('expected an existing samples directory and Tauri Cargo.toml')
    result = runner(['cargo', 'test', '--release', 'owner_high_efficiency', '--', '--nocapture'],
                    cwd=tauri, env={**os.environ, 'KESTREL_RAW_SAMPLES': str(folder)},
                    capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise ValueError('native HE decode test failed; do not record a PASS')
    rows = parse_output(result.stdout + '\n' + result.stderr)
    evidence = []
    for name, decoder, width, height, elapsed in rows:
        path = folder / name
        if not path.is_file() or path.is_symlink():
            raise ValueError('reported sample missing or symlinked')
        digest = hashlib.sha256()
        with path.open('rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                digest.update(chunk)
        evidence.append({'file': name, 'sha256': digest.hexdigest(), 'decoder': decoder,
                         'width': width, 'height': height, 'native_elapsed': elapsed,
                         'sensor_decode_test': 'PASS', 'cfa_hash': None,
                         'colour_accuracy': 'NOT VERIFIED', 'nx_studio_parity': 'NOT RUN'})
    return {'schema': 'kestrel-owner-he-decode-evidence-v1', 'samples': evidence,
            'limits': 'Native test reports decoder/dimensions, not CFA hash, reference comparison or legal clearance.'}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('samples', type=Path)
    p.add_argument('--tauri', type=Path, default=Path('src-tauri'))
    args = p.parse_args()
    try:
        print(json.dumps(collect(args.samples, args.tauri), indent=2))
    except (OSError, ValueError) as exc:
        p.exit(1, f'NOT VERIFIED: {exc}\n')

if __name__ == '__main__':
    main()
