"""Offline, read-only comparison of independent 16-bit TIFF renders from real shoots.

Usage: python scripts/truedetail_shoot_benchmark.py shoot.json > results.json

Manifest paths are relative to the manifest's folder. No photos or file paths
are included in JSON results; only opaque case IDs, fingerprints and metrics.
The metrics describe agreement with a reference, NOT quality superiority.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

BODIES = frozenset({'Z8', 'Z5II'})
COMPRESSION = frozenset({'lossless', 'HE', 'HE*'})
SUBJECTS = frozenset({'birds', 'aircraft', 'people', 'mammals', 'landscapes'})


def _path(folder: Path, value: object, label: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{label}: expected a nonempty file path')
    path = (folder / value).resolve()
    if not path.is_file():
        raise ValueError(f'{label}: input file does not exist')
    return path


def _text(item: dict, key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{key}: required nonempty text')
    return value.strip()


def _region(value: str) -> None:
    try:
        parts = [int(x) for x in value.split(',')]
    except ValueError as exc:
        raise ValueError('Region must be x,y,width,height') from exc
    if len(parts) != 4 or any(n < 0 for n in parts[:2]) or any(n <= 0 for n in parts[2:]):
        raise ValueError('Region must be x,y,width,height with positive dimensions')


def load_manifest(path: Path) -> list[dict]:
    """Validate the entire shoot before reading images or publishing a report."""
    doc = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(doc, dict) or doc.get('format') != 'kestrel-truedetail-shoot-v1':
        raise ValueError('Expected a kestrel-truedetail-shoot-v1 manifest')
    if not isinstance(doc.get('cases'), list) or not doc['cases']:
        raise ValueError('A shoot must contain at least one labelled case')
    seen_ids = set()
    cases = []
    for case in doc['cases']:
        if not isinstance(case, dict):
            raise ValueError('Invalid case object')
        case_id = _text(case, 'id')
        if case_id in seen_ids:
            raise ValueError(f'Duplicate case ID: {case_id}')
        seen_ids.add(case_id)
        body, compression, subject = (_text(case, key) for key in ('body', 'compression', 'subject'))
        if body not in BODIES or compression not in COMPRESSION or subject not in SUBJECTS:
            raise ValueError(f'{case_id}: unsupported body, compression or subject')
        firmware, iso = _text(case, 'firmware'), case.get('iso')
        if type(iso) is not int or not (50 <= iso <= 102400):
            raise ValueError(f'{case_id}: ISO must be an integer between 50 and 102400')
        original = _path(path.parent, case.get('original'), f'{case_id} original')
        reference = _path(path.parent, case.get('reference'), f'{case_id} reference')
        variants = case.get('variants')
        if not isinstance(variants, dict) or not variants:
            raise ValueError(f'{case_id}: provide at least one named variant')
        paths = [original, reference]
        prepared_variants = {}
        for name, value in variants.items():
            if not isinstance(name, str) or not name.strip():
                raise ValueError(f'{case_id}: empty variant name')
            if name in prepared_variants:
                raise ValueError(f'{case_id}: repeated variant name')
            prepared_variants[name] = _path(path.parent, value, f'{case_id} {name}')
            paths.append(prepared_variants[name])
        # samefile rejects symlinks and hardlinks too, preserving independent provenance.
        for a in range(len(paths)):
            for b in range(a + 1, len(paths)):
                if paths[a].samefile(paths[b]):
                    raise ValueError(f'{case_id}: original, reference and variants must be separate files')
        regions = case.get('regions')
        if not isinstance(regions, dict) or not regions:
            raise ValueError(f'{case_id}: labelled regions are required')
        prepared_regions = []
        for name, value in regions.items():
            if not isinstance(name, str) or not name.strip() or not isinstance(value, str):
                raise ValueError(f'{case_id}: invalid named region')
            _region(value)
            prepared_regions.append((name, value))
        cases.append(dict(id=case_id, body=body, firmware=firmware, compression=compression,
                          subject=subject, iso=iso, original=original, reference=reference,
                          variants=prepared_variants, regions=prepared_regions))
    return cases


def run_shoot(manifest: Path, *, comparison=None, detail=None) -> dict:
    """Produce a complete report or fail before publishing partial metrics."""
    from compare_nikon_tiffs import compare, sha256_file
    from benchmark_nikon_detail import benchmark
    comparison = comparison or compare
    detail = detail or benchmark
    cases = load_manifest(manifest)
    reports = []
    for case in cases:
        variants = {}
        for name, path in case['variants'].items():
            whole = comparison(case['reference'], path, source_nef=case['original'])
            regions = detail(case['reference'], path, case['regions'])
            variants[name] = {
                'full_image': whole,
                'regions': regions['regions'],
            }
        reports.append({
            'id': case['id'], 'body': case['body'], 'firmware': case['firmware'],
            'compression': case['compression'], 'subject': case['subject'], 'iso': case['iso'],
            'original_sha256': sha256_file(case['original']),
            'variants': variants,
        })
    return {
        'format': 'kestrel-truedetail-results-v1',
        'evidence': 'reference-agreement-only; real visual quality and detail recovery not proven',
        'cases': reports,
        'case_count': len(reports),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    try:
        report = run_shoot(args.manifest.resolve())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        parser.exit(2, f'TrueDetail benchmark refused: {exc}\n')
    print(json.dumps(report, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
