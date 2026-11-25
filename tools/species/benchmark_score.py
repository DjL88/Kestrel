"""
Score species naming on the benchmark photos the way the app names them, to measure accuracy per group.

    python tools/species/benchmark_score.py BIOCLIP_V1_WEIGHTS BENCHMARK_FOLDER REGION OUT.json

Per photo, mirroring useSpeciesScan:
  1. the category gate (CLIP, src/assets/subject/*; maths of tools/subject-router/try_router.py) gives a route and
     allow / strict / block; an automatic name needs "allow";
  2. the photo is ranked only against the label groups of the gate's category (all groups when it is not sure);
  3. the best match across every list must be in that group, or no name;
  4. the top name needs its group's bar (src/core/autoTags.ts: birds and insects 0.90, others 0.95); else, for birds, the
     family may be named when its species together reach 0.90 and it has two or more members;
  5. otherwise no name.
Lists: shipped UK names, world birds, mammals, reptiles, amphibians, dragonflies, Lepidoptera, filtered to REGION.
Reports right / wrong / family / no name per group, at the app's bars and at alternative bars for comparison.
"""
import base64, json, sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import onnxruntime as ort
import open_clip, torch
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / 'tools/subject-router'))
from try_router import HERE, LOGIT_SCALE, load_categories, preprocess  # noqa: E402

weights, folder, region, target = sys.argv[1:5]
folder = Path(folder)
BARS = {'bird': 0.9, 'mammal': 0.95, 'reptile': 0.95, 'amphibian': 0.95, 'insect': 0.9}  # src/core/autoTags.ts AUTO_MINIMUM_BY_GROUP
FAMILY_BAR = 0.9  # src/core/autoTags.ts FAMILY_MINIMUM
GROUPS = {'bird': ['bird'], 'bird-of-prey': ['bird'], 'waterbird': ['bird'], 'mammal': ['mammal'], 'reptile': ['reptile', 'amphibian'], 'insect': ['insect']}

# Species lists, as the app loads them (UK names first, then the world lists, no name twice, filtered by region).
world = json.load(open(ROOT / 'public/models/species-world.json', encoding='utf-8'))['labels']
family_of = {l['scientific'].lower(): l.get('family') for l in world}
labels, seen = [], set()
for path in ['src/assets/species/uk.json', 'public/models/species-world.json', 'public/models/species-mammals.json', 'public/models/species-reptiles.json',
             'public/models/species-amphibians.json', 'public/models/species-odonata.json', 'public/models/species-lepidoptera.json']:
    for l in json.load(open(ROOT / path, encoding='utf-8'))['labels']:
        key = l['scientific'].lower()
        if key in seen or (l.get('regions') and region not in l['regions']):
            continue
        seen.add(key)
        family = family_of.get(key) if l.get('group', 'bird') == 'bird' else None  # only bird families are offered as names
        labels.append({**l, 'group': l.get('group', 'bird'), 'family': family})
vectors = np.stack([np.frombuffer(base64.b64decode(l['vector']), dtype=np.int8).astype(np.float32) * l['scale'] for l in labels])
vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
groups_of = np.array([l['group'] for l in labels])
print(len(labels), 'names in region', region)

gate_session = ort.InferenceSession(str(HERE / 'models/vision_model_uint8.onnx'), providers=['CPUExecutionProvider'])
taxonomy, gate_vectors = load_categories()
model, _, bio_preprocess = open_clip.create_model_and_transforms('ViT-B-16', pretrained=weights)
model.eval()


def softmax(logits):
    p = np.exp(logits - logits.max()); return p / p.sum()


def gate(path):
    e = gate_session.run(None, {'pixel_values': preprocess(path)})[0][0].astype(np.float64)
    p = softmax(LOGIT_SCALE * gate_vectors @ (e / np.linalg.norm(e)))
    order = np.argsort(-p)
    confident = p[order[0]] >= 0.45 and p[order[0]] - p[order[1]] >= 0.15
    species = sum(p[i] for i, c in enumerate(taxonomy) if c['group'] == 'animal' and c['identify'] == 'species')
    animal = sum(p[i] for i, c in enumerate(taxonomy) if c['group'] == 'animal')
    verdict = 'allow' if species >= 0.6 else 'block' if 1 - animal >= 0.6 else 'strict'
    return (taxonomy[order[0]]['id'] if confident else None), verdict


def name(embedding, category, verdict, bars, family_bar=0.8, unsure='all'):
    """What the app would write: ('species', scientific) / ('family', family) / ('none', reason)."""
    if verdict != 'allow':
        return ('none', 'gate ' + verdict)
    allowed = GROUPS.get(category)
    if unsure == 'none' and not allowed:
        return ('none', 'gate not sure of the group')
    overall = softmax(100 * vectors @ embedding)
    if allowed and groups_of[int(np.argmax(overall))] not in allowed:
        return ('none', 'gate and species model disagree on the group')
    keep = np.arange(len(labels)) if not allowed else np.flatnonzero(np.isin(groups_of, allowed))
    p = softmax(100 * vectors[keep] @ embedding)
    top = labels[keep[int(np.argmax(p))]]
    if p.max() >= bars[top['group']]:
        return ('species', top['scientific'])
    shares = defaultdict(lambda: [0.0, 0])
    for i, share in zip(keep, p):
        if labels[i]['family']:
            shares[labels[i]['family']][0] += share; shares[labels[i]['family']][1] += 1
    best = max(((f, s) for f, (s, n) in shares.items() if n >= 2 and s >= family_bar), key=lambda x: x[1], default=None)
    return ('family', best[0]) if best else ('none', 'not sure enough')


# (bars per group, family bar, what to do when the gate is not sure of the group). The sweep gives every group the same bar
# b (and the family the same b); a photo's result depends only on the bar of its top name's group, so each group's row of
# the sweep is that group's result at bar b.
SWEEP = [round(0.90 + 0.01 * i, 2) for i in range(10)]
SETTINGS = {
    'app': (BARS, FAMILY_BAR, 'all'),
    'before (birds 0.8, family 0.8)': ({**dict.fromkeys(BARS, 0.95), 'bird': 0.8}, 0.8, 'all'),
    **{f'all {b:.2f}': (dict.fromkeys(BARS, b), b, 'all') for b in SWEEP},
}
# Commons files whose category is wrong, checked by eye: the name the app gave is what the photo shows.
CORRECTIONS = {
    'Capreolus_capreolus__182037768.jpg': 'Milvus milvus',  # a red kite on a roe deer carcass (also filed under Milvus milvus)
    'Macroglossum_stellatarum__151274097.jpg': 'Merops apiaster',  # a bee-eater holding the hawk-moth
}
manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
rows = []
for item in manifest:
    path = str(folder / item['file'])
    category, verdict = gate(path)
    with torch.no_grad():
        e = model.encode_image(bio_preprocess(Image.open(path).convert('RGB')).unsqueeze(0), normalize=True).numpy()[0]
    truth = CORRECTIONS.get(item['file'], item['scientific'])
    row = {'file': item['file'], 'group': item['group'], 'truth': truth, 'gate': [category, verdict]}
    truth_family = family_of.get(truth.lower())
    for label, (bars, family_bar, unsure) in SETTINGS.items():
        kind, value = name(e, category, verdict, bars, family_bar, unsure)
        row[label] = {'kind': kind, 'value': value,
                      'right': kind == 'species' and value == truth or kind == 'family' and value == truth_family}
    rows.append(row)
json.dump(rows, open(target, 'w', encoding='utf-8'), indent=1)


def tally(rs, setting):
    named = [r for r in rs if r[setting]['kind'] != 'none']
    right = sum(r[setting]['right'] for r in named)
    return right, len(named), len(rs)


GROUPS_SHOWN = ['bird', 'mammal', 'reptile', 'amphibian', 'insect', 'all']
for setting in ['before (birds 0.8, family 0.8)', 'app']:
    print()
    print(f'== {setting}')
    for group in GROUPS_SHOWN:
        right, named, n = tally([r for r in rows if group == 'all' or r['group'] == group], setting)
        print(f"{group:9} n={n:3}  named {named:3}  wrong {named - right:2}  accuracy {right / named:.1%}  coverage {named / n:.0%}" if named else f"{group:9} n={n:3}  no names given")

print()
print('== sweep: accuracy of names written / coverage, per group (bar for species and family alike)')
print('group     ' + ''.join(f'{b:>14.2f}' for b in SWEEP))
for group in GROUPS_SHOWN:
    cells = []
    for b in SWEEP:
        right, named, n = tally([r for r in rows if group == 'all' or r['group'] == group], f'all {b:.2f}')
        cells.append(f"{right}/{named} {named / n:.0%}" if named else '-')
    print(f'{group:9} ' + ''.join(f'{c:>14}' for c in cells))
wrong = [r for r in rows if r['app']['kind'] != 'none' and not r['app']['right']]
print()
print('Wrong names at the app bars:')
for r in wrong:
    print(f"  {r['file']}: {r['truth']} -> {r['app']['kind']} {r['app']['value']}")
