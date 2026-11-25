"""
BioCLIP name vectors for one extra species group, from rows made by tools/species/group_rows.mjs, so no text model ships.

    python tools/species/make_vectors.py ROWS.json GROUP ARCH WEIGHTS SOURCE_TEXT ATTRIBUTION OUT.json

GROUP is the label group the app shows ('reptile', 'amphibian', 'insect'). ARCH and WEIGHTS name the species model the
app ships and must match its image half: 'ViT-B-16' with BioCLIP's open_clip_pytorch_model.bin (512 numbers, every
device) or 'ViT-L-14' with BioCLIP 2 (768, the desktop second-opinion pack). The template and int8 scheme are the same as
make_world.py and make_mammals.py, so every list is compared the same way. Local names stay in species-names/, not here.
"""
import base64, hashlib, json, sys
import numpy as np

rows_path, group, arch, weights, source_text, attribution, target = sys.argv[1:8]
TEMPLATE = 'a photo of {scientific}, {common}'
rows = json.load(open(rows_path, encoding='utf-8'))['rows']
print(len(rows), 'species')

import open_clip, torch
model, _, _ = open_clip.create_model_and_transforms(arch, pretrained=weights)
model.eval()
tokenizer = open_clip.get_tokenizer(arch)
labels = []
with torch.no_grad():
    for i in range(0, len(rows), 256):
        chunk = rows[i:i + 256]
        prompts = [TEMPLATE.format(scientific=r['scientific'], common=r['common'].lower()) for r in chunk]
        vectors = model.encode_text(tokenizer(prompts), normalize=True).numpy()
        for row, vector in zip(chunk, vectors):
            scale = float(np.abs(vector).max() / 127)
            q = np.clip(np.round(vector / scale), -127, 127).astype(np.int8)
            labels.append({'common': row['common'], 'scientific': row['scientific'], 'group': group, 'family': row.get('family') or None,
                           'regions': row['regions'], 'scale': round(scale, 8), 'vector': base64.b64encode(q.tobytes()).decode('ascii')})
json.dump({'version': 1, 'model': arch, 'dimensions': len(base64.b64decode(labels[0]['vector'])), 'template': TEMPLATE,
           'source': source_text, 'rowsSha256': hashlib.sha256(open(rows_path, 'rb').read()).hexdigest(),
           'attribution': attribution, 'labels': labels}, open(target, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
print(f'{len(labels)} names written to {target}')
