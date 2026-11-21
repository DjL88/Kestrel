import json, sys
import numpy as np
from PIL import Image
import skimage.data as data
from smolvlm_onnx import SmolVLM, peak_rss_mb

root = '/home/user/kestrel-models/smolvlm2-500m/4cde9d208e19'
model = SmolVLM(root, 'int8')
print(f'loaded in {model.load_seconds:.1f}s, peak RSS {peak_rss_mb():.0f} MB')
images = {'cat (chelsea)': data.chelsea(), 'coffee cup': data.coffee(), 'astronaut': data.astronaut(), 'rocket': data.rocket()}
for name, array in images.items():
    result = model.ask(Image.fromarray(array), 'What is the main subject of this photo? Answer in one short sentence.', 40)
    print(f"\n[{name}] {result['text']!r}")
    print({k: (round(v, 2) if isinstance(v, float) else v) for k, v in result.items() if k != 'text'}, f'peak RSS {peak_rss_mb():.0f} MB')
