"""
Makes the SYNTHETIC species list the browser tests use (tests/fixtures/stand-in-species-labels.json): a few real bird names
(names are facts; the English and Latin names are from the IOC World Bird List, CC BY 4.0) with random, seeded, made-up vectors.
Nothing here comes from BioCLIP or any other model, so no RED data is in the repository. The stand-in species model
(tests/fixtures/stand-in-species.onnx) is then made from the same file with tools/species/make_stand_in.py:

    python tools/species/make_synthetic_labels.py tests/fixtures/stand-in-species-labels.json
    python tools/species/make_stand_in.py tests/fixtures/stand-in-species-labels.json "Red kite" tests/fixtures/stand-in-species.onnx
"""
import base64, json, sys
import numpy as np

NAMES = [
    ('Red kite', 'Milvus milvus'), ('Common buzzard', 'Buteo buteo'), ('Barn owl', 'Tyto alba'), ('Eurasian wren', 'Troglodytes troglodytes'),
    ('Mallard', 'Anas platyrhynchos'), ('European robin', 'Erithacus rubecula'), ('Eurasian blue tit', 'Cyanistes caeruleus'), ('Common kestrel', 'Falco tinnunculus'),
]
rng = np.random.default_rng(20261128)
labels = []
for common, scientific in NAMES:
    v = rng.standard_normal(512)
    v /= np.linalg.norm(v)
    scale = float(np.abs(v).max() / 127)
    q = np.round(v / scale).astype(np.int8)
    labels.append({'common': common, 'scientific': scientific, 'group': 'bird', 'scale': scale, 'vector': base64.b64encode(q.tobytes()).decode()})
json.dump({'version': 1, 'dimensions': 512, 'template': 'synthetic test list, not from any model', 'labels': labels}, open(sys.argv[1], 'w'), indent=1)
print('wrote', sys.argv[1])
