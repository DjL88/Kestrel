#!/usr/bin/env python3
"""Embed the cached previews with the SHIPPED frozen DINOv2 ViT-S/14 (Apache-2.0, fp16 ONNX) through onnxruntime-web (the app's own runtime, via node), as the editor
does it (src/core/visualSimilarity.ts): shorter side to 256, centre 224 crop, ImageNet mean/std, 384-d output.
Writes embeddings.npz next to sample.jsonl (outside Git). Usage: embed.py [--model path/to/dinov2-small-fp16.onnx]
"""
import argparse, hashlib, json, os, subprocess
import numpy as np
from PIL import Image

OUT = os.path.expanduser('~/code/kestrel-test-photos/species-own')
MODEL = os.path.expanduser('~/code/kestrel/public/models/dinov2-small-fp16.onnx')
EXPECT_SHA = '31194260449c7916c6e08b87bb44b7a36950d7eab0dffc41ae1bdff33c950bc8'


def prep(path):
    """Shorter side to 256, centre 224 (embeddingCrop in visualSimilarity.ts). Returns 224x224x3 uint8."""
    im = Image.open(path).convert('RGB')
    w, h = im.size
    size = round(min(w, h) * 224 / 256)
    x, y = round((w - size) / 2), round((h - size) / 2)
    return np.asarray(im.crop((x, y, x + size, y + size)).resize((224, 224), Image.LANCZOS), np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default=MODEL)
    a = ap.parse_args()
    sha = hashlib.sha256(open(a.model, 'rb').read()).hexdigest()
    assert sha == EXPECT_SHA, f'unexpected model file {sha}'
    rows = [json.loads(l) for l in open(os.path.join(OUT, 'sample.jsonl'))]
    keep, crops = [], []
    for r in rows:
        p = os.path.join(OUT, 'previews', r['id'] + '.jpg')
        if r['ok'] and os.path.exists(p):
            crops.append(prep(p)); keep.append(r['id'])
    cp, op = os.path.join(OUT, 'crops.u8'), os.path.join(OUT, 'emb.f32')
    np.stack(crops).tofile(cp)
    here = os.path.dirname(os.path.abspath(__file__))
    subprocess.run(['node', os.path.join(here, 'embed_run.mjs'), a.model, cp, str(len(keep)), op], check=True)
    x = np.fromfile(op, np.float32).reshape(len(keep), 384)
    assert np.isfinite(x).all(), 'non-finite embeddings'
    os.remove(cp); os.remove(op)
    np.savez(os.path.join(OUT, 'embeddings.npz'), ids=np.array(keep), x=x, model_sha=sha)
    print(len(keep), 'embeddings')


if __name__ == '__main__':
    main()
