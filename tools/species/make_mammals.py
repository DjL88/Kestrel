"""
Build the world mammal list the app can name, from the Mammal Diversity Database (MDD v2.5, CC BY 4.0,
https://doi.org/10.5281/zenodo.21654811), with BioCLIP name vectors made once here so no text model ships.

    python tools/species/make_mammals.py MDD_v2.5_6904species.csv ARCH WEIGHTS public/models/species-mammals.json

ARCH and WEIGHTS name the species model the app ships, and must match its image half: 'ViT-B-16' with BioCLIP's
open_clip_pytorch_model.bin (512 numbers per name, as species-world.json), or 'ViT-L-14' with BioCLIP 2's
open_clip_model.safetensors (768). The template and the int8 scheme are the same as make_world.py, so every list is
compared the same way.

Extant wild and domestic species only (no recently extinct). Each label keeps its MDD family and the app's region codes
from MDD's biogeographic realms, so a person's regions narrow the choices and a doubtful animal can be named by family.
Needs numpy, torch and open_clip_torch.
"""
import base64, csv, hashlib, json, sys
import numpy as np

source, arch, weights, target = sys.argv[1:5]
TEMPLATE = 'a photo of {scientific}, {common}'
# MDD biogeographic realm -> the region codes in src/core/speciesRegions.ts.
REALM = {'Palearctic': 'PAL', 'Nearctic': 'NA', 'Neotropic': 'SA', 'Afrotropic': 'AF', 'Indomalaya': 'OR',
         'Indomalaya?': 'OR', 'Australasia': 'AU', 'Oceania (Biorealm)': 'PO', 'Marine': 'MA'}

rows = []
with open(source, encoding='utf-8') as handle:
    for r in csv.DictReader(handle):
        if r['extinct'] != '0' or not r['mainCommonName'].strip():
            continue
        regions = sorted({REALM[v.strip()] for v in r['biogeographicRealm'].split('|') if v.strip() in REALM})
        rows.append({'common': r['mainCommonName'].strip(), 'scientific': r['sciName'].replace('_', ' ').strip(),
                     'group': 'mammal', 'family': r['family'].strip().capitalize(), 'regions': regions,
                     'domestic': r['domestic'] == '1'})
print(len(rows), 'species')

import open_clip, torch
model, _, _ = open_clip.create_model_and_transforms(arch, pretrained=weights)
model.eval()
tokenizer = open_clip.get_tokenizer(arch)
labels = []
with torch.no_grad():
    for i in range(0, len(rows), 256):
        chunk = rows[i:i + 256]
        vectors = model.encode_text(tokenizer([TEMPLATE.format(scientific=r['scientific'], common=r['common'].lower()) for r in chunk]), normalize=True).numpy()
        for row, vector in zip(chunk, vectors):
            scale = float(np.abs(vector).max() / 127)
            q = np.clip(np.round(vector / scale), -127, 127).astype(np.int8)
            labels.append({**row, 'scale': round(scale, 8), 'vector': base64.b64encode(q.tobytes()).decode('ascii')})
sha = hashlib.sha256(open(source, 'rb').read()).hexdigest()
json.dump({'version': 1, 'model': arch, 'dimensions': int(labels[0] and len(base64.b64decode(labels[0]['vector']))),
           'template': TEMPLATE, 'source': 'Mammal Diversity Database v2.5 (CC BY 4.0)', 'sourceSha256': sha,
           'attribution': 'Mammal names: Mammal Diversity Database (2026), version 2.5, Zenodo, https://doi.org/10.5281/zenodo.21654811, CC BY 4.0.',
           'labels': labels}, open(target, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
print(f'{len(labels)} names written to {target}')
