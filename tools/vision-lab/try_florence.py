from PIL import Image
import skimage.data as data
from florence_onnx import Florence
from smolvlm_onnx import peak_rss_mb

model = Florence('/home/user/kestrel-models/florence-2-base/d59e079711c5', 'int8')
print(f'loaded in {model.load_seconds:.1f}s, peak RSS {peak_rss_mb():.0f} MB')
for name, array in {'cat': data.chelsea(), 'coffee': data.coffee(), 'astronaut': data.astronaut(), 'rocket': data.rocket()}.items():
    image = Image.fromarray(array)
    r = model.run(image, '<OD>')
    print(f"\n[{name}] {image.size} {r['seconds']:.2f}s  RSS {peak_rss_mb():.0f} MB")
    for b in r['boxes']:
        print('  ', b['label'], [round(v) for v in b['box']])
    if not r['boxes']:
        print('  raw:', r['raw'][:160])
