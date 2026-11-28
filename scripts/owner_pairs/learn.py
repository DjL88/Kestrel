#!/usr/bin/env python3
"""Aggregate per-pair fits into the owner's 'your look' profile (JSON). Numbers only, no paths.

This is the OWNER'S OWN look, learned from their finished photos. It is separate from, and must not be mixed with,
the generic best-practice rules in docs/EDITING-KNOWLEDGE-SOURCES.md.
Fits are relative to the camera's embedded JPEG, not Kestrel's own RAW render.
"""
import argparse, json, os, statistics as st

SLIDERS = ['exposure', 'warmth', 'tint', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'colour']
GOOD_NCC, GOOD_LOSS_AFTER, GOOD_GAIN = 0.85, 0.06, 0.25   # fit must remove >=25% of the gap to count as explained


def q(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(p * (len(v) - 1) + 0.5))]


def summarise(rows, minimum=8):
    if len(rows) < minimum:
        return {'n': len(rows), 'note': f'fewer than {minimum} pairs: not enough to describe a habit'}
    out = {'n': len(rows)}
    for k in SLIDERS:
        v = [r['edit'][k] for r in rows]
        out[k] = {'median': round(st.median(v), 2), 'p25': round(q(v, .25), 2), 'p75': round(q(v, .75), 2)}
    out['lumShift'] = round(st.median(r['lumFinal'] - r['lumRaw'] for r in rows), 3)
    out['share_lifted'] = round(sum(r['lumFinal'] - r['lumRaw'] > 0.04 for r in rows) / len(rows), 2)
    out['share_darkened'] = round(sum(r['lumFinal'] - r['lumRaw'] < -0.03 for r in rows) / len(rows), 2)
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); a = ap.parse_args()
    fits = [json.loads(l) for l in open(os.path.join(a.out, 'fits.jsonl'))]
    pairs = {p['raw_hash'] + '_' + p['img_hash']: p for p in json.load(open(os.path.join(a.out, 'pairs.json')))}
    used = [r for r in fits if 'edit' in r and r['ncc'] >= GOOD_NCC and r['lossAfter'] <= GOOD_LOSS_AFTER]
    poor = [r for r in fits if 'edit' in r and r not in used]
    def lum_bin(r): return 'dark(<0.18)' if r['lumRaw'] < 0.18 else 'mid(0.18-0.3)' if r['lumRaw'] < 0.3 else 'bright(>=0.3)'
    def focal_bin(r): f = r.get('focal') or 0; return 'long(>=300mm)' if f >= 300 else 'mid(100-300mm)' if f >= 100 else 'short(<100mm)' if f else 'unknown'
    def iso_bin(r): i = r.get('iso') or 0; return 'iso<=800' if i <= 800 else 'iso800-3200' if i <= 3200 else 'iso>3200'
    def fast(r): return 'shutter<=1/1600' if (r.get('et') or 1) <= 1 / 1600 else 'slower'
    groups = {}
    for name, fn in (('by_raw_brightness', lum_bin), ('by_focal_length', focal_bin), ('by_iso', iso_bin), ('by_shutter', fast)):
        g = {}
        for r in used: g.setdefault(fn(r), []).append(r)
        groups[name] = {k: summarise(v) for k, v in sorted(g.items())}
    low_key_kept = [r for r in used if r['lumFinal'] < 0.2 and r['lumFinal'] - r['lumRaw'] <= 0.02]
    profile = {
        'label': "OWNER'S OWN LOOK (learned from their finished photos). Not generic best practice.",
        'baseline': "camera's embedded JPEG, not Kestrel's RAW render",
        'pairs_considered': len(fits), 'pairs_fitted_well': len(used), 'pairs_poor_or_unaligned': len(fits) - len(used),
        'overall': summarise(used), **groups,
        'kept_low_key': {'n': len(low_key_kept), 'share_of_dark_raws': round(len(low_key_kept) / max(1, sum(r['lumRaw'] < 0.2 for r in used)), 2)},
        'fit_quality': {'median_loss_before': round(st.median(r['lossBefore'] for r in used), 3) if used else None,
                        'median_loss_after': round(st.median(r['lossAfter'] for r in used), 3) if used else None},
        'not_measured': ['subject-vs-background lift', 'local masks', 'denoise strength', 'sharpening strength', 'subject type (only lens focal length as a proxy)'],
    }
    json.dump(profile, open(os.path.join(a.out, 'your-look-profile.json'), 'w'), indent=1)
    json.dump([{'raw_hash': r['key'].split('_')[0], 'camera': r['model'], 'iso': r['iso'], 'shutter': r['et'], 'f': r['f'], 'ev': r['ev'],
                'edit': {k: round(v, 2) for k, v in r['edit'].items()}, 'loss': round(r['lossAfter'], 3)} for r in used],
              open(os.path.join(a.out, 'eval-set.json'), 'w'))
    print(json.dumps(profile, indent=1))

if __name__ == '__main__':
    main()
