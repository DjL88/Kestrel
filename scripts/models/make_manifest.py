#!/usr/bin/env python3
"""Builds manifest.json: exact revisions, licences, sizes and hashes for the offline vision models.

Run this when choosing or bumping a model; commit the result. The hashes come from the model host's own metadata at a
pinned revision, so they are the host's claim, not an independent check: acquire.py verifies the bytes it downloads against
them, and the first install on a trusted network should be compared with the model card by a person.
Large files carry a SHA-256 (LFS). Small files carry the git blob id (SHA-1 of "blob <size>\\0<bytes>").
"""
import json, sys, urllib.request

API = 'https://huggingface.co/api/models/'
# Chosen by docs/models.md: a small core set. Quantisations: int8 runs well on plain CPUs; q4 is smallest.
CORE = {
    'smolvlm2-500m': {
        'repo': 'HuggingFaceTB/SmolVLM2-500M-Video-Instruct', 'revision': '4cde9d208e19',
        'role': 'Everyday visual analysis: scene and subject validation, plain-language checks, bounded suggestions.',
        'onnx': ['vision_encoder', 'embed_tokens', 'decoder_model_merged'],
    },
    'florence-2-base': {
        'repo': 'onnx-community/Florence-2-base', 'revision': 'd59e079711c5',
        'role': 'Grounding: locating subjects and regions, finding mask gaps. Not a chat model.',
        'onnx': ['vision_encoder', 'embed_tokens', 'encoder_model', 'decoder_model_merged'],
    },
}
QUANT = ['int8', 'q4']

def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'kestrel-model-manifest'})
    return json.load(urllib.request.urlopen(request, timeout=60))

def main():
    out = {'schema': 1, 'models': {}}
    for key, spec in CORE.items():
        info = get(f"{API}{spec['repo']}?blobs=true")
        if not info['sha'].startswith(spec['revision']):
            sys.exit(f"{spec['repo']}: moved on from pinned revision {spec['revision']} (now {info['sha'][:12]}). Review before bumping.")
        card = (info.get('cardData') or {}).get('license')
        tags = [t for t in info.get('tags', []) if t.startswith('license:')]
        if not card and not tags:
            sys.exit(f"{spec['repo']}: no licence in the model metadata. Do not ship it without reading the card.")
        wanted = {f"onnx/{name}_{q}.onnx" for name in spec['onnx'] for q in QUANT}
        files = []
        for s in sorted(info['siblings'], key=lambda s: s['rfilename']):
            name = s['rfilename']
            small_root = '/' not in name and (name.endswith('.json') or name.endswith('.txt') or name.endswith('.model'))
            if name not in wanted and not small_root:
                continue
            entry = {'path': name, 'bytes': s.get('size') or 0}
            if s.get('lfs'):
                entry['sha256'] = s['lfs']['sha256']
            else:
                entry['gitBlob'] = s['blobId']
            files.append(entry)
        missing = wanted - {f['path'] for f in files}
        if missing:
            sys.exit(f"{spec['repo']}: missing expected files {sorted(missing)}")
        out['models'][key] = {
            'repo': spec['repo'], 'revision': info['sha'], 'role': spec['role'],
            'license': card or tags[0].split(':', 1)[1], 'licenseSource': 'model card metadata at this revision',
            'url': f"https://huggingface.co/{spec['repo']}/tree/{info['sha']}", 'files': files,
        }
    json.dump(out, open('manifest.json', 'w'), indent=2)
    open('manifest.json', 'a').write('\n')
    for key, m in out['models'].items():
        total = {q: sum(f['bytes'] for f in m['files'] if f['path'].endswith(f'_{q}.onnx')) / 1e6 for q in QUANT}
        print(key, m['license'], m['revision'][:12], {q: f'{v:.0f} MB' for q, v in total.items()})

if __name__ == '__main__':
    main()
