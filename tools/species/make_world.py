"""
Build the world bird list the app can name, from the IOC World Bird List (Gill, Donsker and Rasmussen, CC BY 4.0,
https://www.worldbirdnames.org), with BioCLIP name vectors made once here so no text model ships.

    python tools/species/make_world.py master_ioc_list.xlsx open_clip_pytorch_model.bin public/models/species-world.json

Needs openpyxl, numpy, torch and open_clip_torch. Species only (no subspecies, no extinct). Each label keeps the IOC
breeding-range region codes (AF AN AS AU EU NA OC SA and the oceans) so a person's regions can narrow the choices.
Vectors use the same template and int8 scheme as make_labels.py, so both files are compared the same way.
"""
import base64, json, sys
import numpy as np
import openpyxl

source, weights, target = sys.argv[1:4]
TEMPLATE = 'a photo of {scientific}, {common}'

rows, family, genus = [], '', ''
for r in openpyxl.load_workbook(source, read_only=True)['Master'].iter_rows(min_row=5, values_only=True):
    if r[4] and not r[10] and not r[6]: family = str(r[4]).strip()
    if r[5]: genus = str(r[5]).strip()
    if r[6] and not r[7] and r[10] and not r[8]:  # a species with an English name, not a subspecies, not extinct
        regions = sorted({c for c in str(r[11] or '').replace(',', ' ').split() if c.isalpha() and c.isupper()})
        rows.append({'common': str(r[10]).strip(), 'scientific': f'{genus} {str(r[6]).strip()}', 'family': family, 'regions': regions})
print(len(rows), 'species')

import open_clip, torch
model, _, _ = open_clip.create_model_and_transforms('ViT-B-16', pretrained=weights)
model.eval()
tokenizer = open_clip.get_tokenizer('ViT-B-16')
labels = []
with torch.no_grad():
    for i in range(0, len(rows), 256):
        chunk = rows[i:i + 256]
        vectors = model.encode_text(tokenizer([TEMPLATE.format(scientific=r['scientific'], common=r['common'].lower()) for r in chunk]), normalize=True).numpy()
        for row, vector in zip(chunk, vectors):
            scale = float(np.abs(vector).max() / 127)
            q = np.clip(np.round(vector / scale), -127, 127).astype(np.int8)
            labels.append({'common': row['common'], 'scientific': row['scientific'], 'group': 'bird', 'family': row['family'],
                           'regions': row['regions'], 'scale': round(scale, 8), 'vector': base64.b64encode(q.tobytes()).decode('ascii')})
json.dump({'version': 1, 'source': 'IOC World Bird List 15.2 (CC BY 4.0)', 'dimensions': 512, 'template': TEMPLATE, 'labels': labels},
          open(target, 'w'), separators=(',', ':'))
print(f'{len(labels)} names written to {target}')
