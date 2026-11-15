"""
Turn a species list into the small file the app uses to name what a photo shows.

The app runs only the image half of BioCLIP. Species names are turned into number vectors here, once, using the text
half, so no text model ever ships. Run it with a Python that has torch and open_clip_torch:

    python tools/species/make_labels.py path/to/open_clip_pytorch_model.bin tools/species/species-uk.csv src/assets/species/uk.json

Each vector is stored as int8 with one scale, which keeps a few hundred names under 0.1 MB with no visible loss.
"""
import base64, csv, json, sys
import numpy as np
import open_clip
import torch

weights, source, target = sys.argv[1:4]
TEMPLATE = 'a photo of {scientific}, {common}'  # the style that scored best in the spike (see docs/SPECIES-TAGGING-SPIKE.md)

rows = list(csv.DictReader(open(source, newline='', encoding='utf-8')))
model, _, _ = open_clip.create_model_and_transforms('ViT-B-16', pretrained=weights)
model.eval()
tokenizer = open_clip.get_tokenizer('ViT-B-16')
with torch.no_grad():
    vectors = model.encode_text(tokenizer([TEMPLATE.format(scientific=r['scientific'], common=r['common'].lower()) for r in rows]), normalize=True).numpy()

labels = []
for row, vector in zip(rows, vectors):
    scale = float(np.abs(vector).max() / 127)
    quantised = np.clip(np.round(vector / scale), -127, 127).astype(np.int8)
    labels.append({'common': row['common'], 'scientific': row['scientific'], 'group': row['group'], 'scale': round(scale, 8),
                   'vector': base64.b64encode(quantised.tobytes()).decode('ascii')})
json.dump({'version': 1, 'dimensions': int(vectors.shape[1]), 'template': TEMPLATE, 'labels': labels}, open(target, 'w'), separators=(',', ':'))
print(f'{len(labels)} names written to {target}')
