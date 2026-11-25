"""Reference PP-OCRv5 pipeline on synthetic markings, to check src/core/textOcr.ts against.  python -I ocr_reference.py out.json <model folder>"""
import sys, json
import numpy as np, onnxruntime as ort, yaml
from PIL import Image, ImageDraw, ImageFont
from collections import deque
def label(mask):
    h, w = mask.shape; out = np.zeros((h, w), np.int32); n = 0
    for y0 in range(h):
        for x0 in range(w):
            if mask[y0, x0] and not out[y0, x0]:
                n += 1; q = deque([(y0, x0)]); out[y0, x0] = n
                while q:
                    y, x = q.popleft()
                    for yy, xx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
                        if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not out[yy, xx]:
                            out[yy, xx] = n; q.append((yy, xx))
    return out, n

# det.onnx, rec-en.onnx and rec-en.yml from the pinned revisions in src/providers/markingReader.ts
M = (sys.argv[2] if len(sys.argv) > 2 else 'models/ppocrv5').rstrip('/') + '/'
so = ort.SessionOptions(); so.log_severity_level = 3
det = ort.InferenceSession(M + 'det.onnx', so); rec = ort.InferenceSession(M + 'rec-en.onnx', so)
chars = yaml.safe_load(open(M + 'rec-en.yml', encoding='utf-8'))['PostProcess']['character_dict']
chars = [str(c) for c in chars] + [' ']
MEAN, STD = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])


def synth(text, size=(640, 360), angle=0):
    im = Image.new('RGB', size, (120, 128, 134))
    d = ImageDraw.Draw(im)
    d.polygon([(40, 200), (600, 150), (620, 210), (60, 260)], fill=(150, 156, 160))  # a fuselage
    font = ImageFont.truetype('arialbd.ttf', 44)
    d.text((180, 170), text, fill=(30, 30, 30), font=font)
    return im.rotate(angle, fillcolor=(120, 128, 134))


def run_det(im):
    w, h = im.size
    s = 960 / max(w, h)
    nw, nh = max(32, round(w * s / 32) * 32), max(32, round(h * s / 32) * 32)
    x = ((np.asarray(im.resize((nw, nh)), dtype=np.float32) / 255 - MEAN) / STD).astype(np.float32)
    x = x[:, :, ::-1].copy() if False else x  # Paddle decodes BGR, then normalises with RGB-ordered stats on BGR data
    prob = det.run(None, {'x': x.transpose(2, 0, 1)[None]})[0][0, 0]
    mask = prob > 0.3
    labels, n = label(mask)
    boxes = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(labels == i)
        score = float(prob[ys, xs].mean())
        if score < 0.6 or len(xs) < 9: continue
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        area, per = (x1 - x0) * (y1 - y0), 2 * ((x1 - x0) + (y1 - y0))
        off = area * 1.5 / per
        boxes.append([max(0, (x0 - off) * w / nw), max(0, (y0 - off) * h / nh), min(w, (x1 + off) * w / nw), min(h, (y1 + off) * h / nh), score])
    return boxes


def run_rec(crop):
    w, h = crop.size
    nw = min(1280, max(16, round(48 * w / h)))
    x = (np.asarray(crop.resize((nw, 48)), dtype=np.float32) / 255 - 0.5) / 0.5
    out = rec.run(None, {'x': x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
    idx, best = out.argmax(1), out.max(1)
    text, conf, last = [], [], 0
    for i, p in zip(idx, best):
        if i != 0 and i != last:
            text.append(chars[i - 1]); conf.append(p)
        last = i
    return ''.join(text), float(np.mean(conf)) if conf else 0.0


results = {}
for text in ['ZK301', 'G-EZAA', 'N172SP', 'EI-DCL']:
    for angle in (0, 6):
        im = synth(text, angle=angle)
        reads = [run_rec(im.crop(tuple(int(v) for v in b[:4]))) for b in run_det(im)]
        results[f'{text}@{angle}'] = reads
        print(text, angle, reads)
json.dump(results, open(sys.argv[1], 'w'), indent=1)
