"""Hard-negative check: can the offline models tell a helicopter from not-a-helicopter?

Data: dcskycam/helicopter-classification, CC-BY-4.0, pinned revision. Images are fetched to a local cache, used only to
measure the models, and never committed. A small sample with a fixed seed: it shows whether the idea works, it is not a
benchmark. Real bird shoots belong to the owner's own evaluation (docs/NEXT-SESSION-PROMPTS, prompt 3).
"""
import csv, io, json, random, re, sys, urllib.request
from pathlib import Path
from PIL import Image
from smolvlm_onnx import SmolVLM, peak_rss_mb
from florence_onnx import Florence

REPO, REVISION = 'dcskycam/helicopter-classification', '36aa0e865a1f204fdd97a9c25458347ca95ceb9a'
CACHE = Path('/home/user/kestrel-models/eval/helicopter')
N = int(sys.argv[1]) if len(sys.argv) > 1 else 12
QUESTION = 'Is there a helicopter in this photo? Answer with one word: yes or no.'
COARSE = 'Is the main subject an aircraft (an aeroplane or a helicopter)? Answer with one word: yes or no.'

def fetch(path: str) -> bytes:
    url = f'https://huggingface.co/datasets/{REPO}/resolve/{REVISION}/{path}'
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'kestrel-eval'}), timeout=60).read()

rows = list(csv.DictReader(io.StringIO(fetch('train/metadata.csv').decode())))
rng = random.Random(7)
sample = []
for kind in ('helicopter', 'not_helicopter'):
    pool = [r for r in rows if r['helicopter_type'] == kind]
    sample += rng.sample(pool, N)

CACHE.mkdir(parents=True, exist_ok=True)
smol = SmolVLM('/home/user/kestrel-models/smolvlm2-500m/4cde9d208e19', 'int8')
flo = Florence('/home/user/kestrel-models/florence-2-base/d59e079711c5', 'int8')
HELI = re.compile(r'helicopter|chopper|rotorcraft', re.I)
AIRCRAFT = re.compile(r'helicopter|airplane|aeroplane|aircraft|jet|plane|rotorcraft|drone', re.I)
results = []
for r in sample:
    local = CACHE / r['file_name']
    if not local.exists():
        local.write_bytes(fetch('train/' + r['file_name']))
    image = Image.open(local)
    image.load()
    image.thumbnail((1024, 1024))
    truth = r['helicopter_type'] == 'helicopter'
    answer = smol.ask(image, QUESTION, 4)['text'].lower()
    smol_says = answer.startswith('yes')
    boxes = flo.run(image, '<OD>')['boxes']
    flo_says = any(HELI.search(b['label']) for b in boxes)
    coarse = smol.ask(image, COARSE, 4)['text'].lower().startswith('yes')
    flo_family = any(AIRCRAFT.search(b['label']) for b in boxes)
    results.append((r['file_name'], truth, smol_says, flo_says, answer, [b['label'] for b in boxes][:5], coarse, flo_family))

def rate(index):
    tp = sum(1 for x in results if x[1] and x[index]); fn = sum(1 for x in results if x[1] and not x[index])
    fp = sum(1 for x in results if not x[1] and x[index]); tn = sum(1 for x in results if not x[1] and not x[index])
    return tp, fn, fp, tn
for name, idx in (('SmolVLM2 "helicopter?"', 2), ('Florence-2 <OD> says helicopter', 3), ('SmolVLM2 "aircraft?" (coarse)', 6), ('Florence-2 <OD> says any aircraft word', 7)):
    tp, fn, fp, tn = rate(idx)
    print(f'{name}: found {tp}/{tp + fn} helicopters, wrongly said helicopter for {fp}/{fp + tn} others')
both = [(x[6], x[7]) for x in results]
union = [(x[6] or x[7]) for x in results]
print('either coarse signal says aircraft: found', sum(1 for x,u in zip(results,union) if x[1] and u), 'of', sum(1 for x in results if x[1]), '; wrongly for', sum(1 for x,u in zip(results,union) if not x[1] and u), 'of', sum(1 for x in results if not x[1]))
print('BOTH coarse signals say aircraft: found', sum(1 for x in results if x[1] and x[6] and x[7]), '; wrongly for', sum(1 for x in results if not x[1] and x[6] and x[7]))
agree = sum(1 for a, b in both if a == b)
print(f'the two coarse signals agree on {agree}/{len(results)}')
print('\nmisses and disagreements:')
for x in results:
    if x[1] != x[2] or x[1] != x[3]:
        print(f"  {x[0]:32} truth={'heli' if x[1] else 'not '} smol={x[4]!r:8} florence={x[5]}")
print(f'\npeak RSS {peak_rss_mb():.0f} MB, n={len(results)} ({N} per class)')
