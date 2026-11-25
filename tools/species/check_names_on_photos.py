"""
Name the calibration photos with BioCLIP v1 the way the app does, to check what a person would be offered.

    python tools/species/check_names_on_photos.py WEIGHTS CALIBRATION_FOLDER REGION_CODE kind[,kind...] LIST.json [LIST.json ...]

For each photo of the given kinds (manifest.json from tools/subject-router/animal_calibration_fetch.py): the species
lists are filtered to the region (and unknown ranges), ranked by similarity with the same logit scale as
src/core/speciesMatch.ts (100), and the top name counts as an automatic tag only at 0.8 or more (src/core/autoTags.ts).
Prints each photo's top three, and whether an automatic tag would be written. Images are never committed.
"""
import base64, json, sys
from pathlib import Path

import numpy as np
import open_clip, torch
from PIL import Image

weights, folder, region, kinds, *lists = sys.argv[1:]
kinds = set(kinds.split(','))
folder = Path(folder)
labels = []
for path in lists:
    for label in json.load(open(path, encoding='utf-8'))['labels']:
        if not label.get('regions') or region in label['regions']:
            labels.append(label)
seen, unique = set(), []
for label in labels:
    if label['scientific'].lower() not in seen:
        seen.add(label['scientific'].lower()); unique.append(label)
vectors = np.stack([np.frombuffer(base64.b64decode(l['vector']), dtype=np.int8).astype(np.float32) * l['scale'] for l in unique])
vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
print(len(unique), 'names in region', region)

model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-16', pretrained=weights)
model.eval()
results = []
for item in json.loads((folder / 'manifest.json').read_text(encoding='utf-8')):
    if item['kind'] not in kinds:
        continue
    with torch.no_grad():
        image = preprocess(Image.open(folder / item['file']).convert('RGB')).unsqueeze(0)
        embedding = model.encode_image(image, normalize=True).numpy()[0]
    logits = 100 * vectors @ embedding
    p = np.exp(logits - logits.max()); p /= p.sum()
    order = np.argsort(-p)[:3]
    top = unique[order[0]]
    tagged = bool(p[order[0]] >= 0.8)
    results.append({'file': item['file'], 'kind': item['kind'], 'category': item['category'], 'top': top['common'], 'scientific': top['scientific'],
                    'group': top['group'], 'share': round(float(p[order[0]]), 3), 'tagged': tagged})
    print(f"{item['kind']:10} {item['category'][:24]:24} -> {'TAG ' if tagged else 'none'} "
          + ', '.join(f"{unique[i]['common']} ({unique[i]['scientific']}) {p[i]:.2f}" for i in order))
json.dump(results, open(folder / f"names-{region}-{'-'.join(sorted(kinds))}.json", 'w', encoding='utf-8'), indent=1)
