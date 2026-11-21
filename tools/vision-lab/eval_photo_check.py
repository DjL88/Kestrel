"""Run the app's Photo Check over many rights-declared photos and save descriptions for the TypeScript fact rules."""
import io, json, random, sys
from pathlib import Path
import numpy as np, pyarrow.parquet as pq, skimage.data as data
from PIL import Image
from photo_check_replica import PhotoCheck, letterbox_rgba

OUT = Path('/home/user/kestrel-models/eval/birds/out'); OUT.mkdir(parents=True, exist_ok=True)
N_PER_CLASS = int(sys.argv[1]) if len(sys.argv) > 1 else 2
model = PhotoCheck('/home/user/kestrel-models/photocheck-256m')
table = pq.read_table('/home/user/kestrel-models/eval/birds/test.parquet')
names = json.loads(table.schema.metadata[b'huggingface'])['info']['features']['label']['names']
rows = table.to_pylist(); rng = random.Random(11)
by_class = {}
for r in rows: by_class.setdefault(r['label'], []).append(r)
items = []
for label, group in sorted(by_class.items()):
    for r in rng.sample(group, min(N_PER_CLASS, len(group))):
        items.append((f'bird-{len(items):03d}', 'bird', names[label], Image.open(io.BytesIO(r['image']['bytes']))))
for name, kind, label, arr in (('astronaut', 'person', 'portrait', data.astronaut()), ('cat', 'animal', 'cat', data.chelsea()), ('coffee', 'object', 'cup', data.coffee()), ('rocket', 'object', 'rocket', data.rocket())):
    items.append((name, kind, label, Image.fromarray(arr)))
results = []
for i, (name, kind, label, image) in enumerate(items):
    rgba = letterbox_rgba(image)
    (OUT / f'{name}.rgba').write_bytes(rgba.tobytes())
    r = model.describe(rgba)
    results.append({'name': name, 'truthKind': kind, 'truthLabel': label, 'description': r['text'], 'seconds': round(r['seconds'], 2)})
    if i % 10 == 0: print(i, len(items), name, '|', r['text'], f"({r['seconds']:.1f}s)", flush=True)
json.dump({'model': 'SmolVLM2-256M int8 (app pin)', 'question': 'Describe this photo in one short sentence.', 'results': results}, open(OUT / 'results.json', 'w'), indent=1)
print('done', len(results), 'photos; load', round(model.load_seconds, 1), 's; mean inference', round(sum(r['seconds'] for r in results) / len(results), 2), 's')
