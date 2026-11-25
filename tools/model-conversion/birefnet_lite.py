"""BiRefNet-lite: fetch the authors' official ONNX and reference weights (pinned), make smaller ONNX variants, and gate
each against the PyTorch reference at 1024 px. Run by .github/workflows/model-conversion.yml; outputs go to an
artifact, never into git.

  python -I tools/model-conversion/birefnet_lite.py all <work_dir>

Stages run one model per process so memory stays bounded:
  fetch   download and verify every pinned file (official ONNX, HF reference code and weights, CC0/public-domain samples)
  ref     PyTorch reference alphas for the gate images -> ref.npz
  export  our own ONNX from the PyTorch model: deformable convolution replaced by an exact pure-PyTorch version
          (tools/model-conversion/deform_conv.py, standard ONNX ops), first checked against the real model on the
          gate images; plus an attempt at a native DeformConv (opset 19) export, recorded either way
  convert fp16 (precision-sensitive ops kept fp32) and weight-only fp16 (fp16 weights, fp32 compute) of a given ONNX
  run     one variant against ref.npz -> gate-<name>.json (time per run, peak memory)
The run of 25 Nov 2026 showed the authors' own published ONNX differs from their PyTorch model on soft edges, so the
gated files are exported here from the pinned PyTorch model.
PASS per image: mean |alpha diff| <= 0.005, IoU(alpha >= 0.5) >= 0.99, mean |diff| in the reference's soft-edge band
(0.05..0.95) <= 0.03.
"""
import hashlib, json, os, pathlib, subprocess, sys, time, urllib.request

ONNX_URL = 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx'
ONNX_SHA = '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333'
HF = 'https://huggingface.co/ZhengPeng7/BiRefNet_lite/resolve/aa62cd87eafb9cc43056d08ef3615a14628b831d'
HF_FILES = {
    'model.safetensors': '4417d89795250e698c3cb0ae8df15743810065f646f48a694fdfa7ca052d0815',
    'birefnet.py': 'af8568b5be406bf4d2a68a7ed6d72e40f73b37a1fb6fc9ebd71b5b3cbcd069c9',
    'BiRefNet_config.py': 'e7b8c2a74f6cea6a59553d517f71d47f2c1d90e670a13416af17c25fe2f3dc52',
    'config.json': '9dc8614fccddd40c601aeadc69b9db6dd820598179b2a2198492e6ffa016a824',
}
SAMPLES = 'https://raw.githubusercontent.com/scikit-image/scikit-image/v0.24.0/skimage/data'
SAMPLE_FILES = ['astronaut.png', 'chelsea.png', 'coffee.png', 'rocket.jpg']  # public domain / CC0 (skimage/data/_fetchers.py)
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)
SIZE = int(os.environ.get('BIREFNET_SIZE', '1024'))  # smaller only for a local smoke test
KEEP_FP32 = ['Resize', 'Softmax', 'LayerNormalization', 'Erf', 'Div', 'Sigmoid', 'GatherND', 'ScatterND', 'Floor', 'Mod', 'BatchNormalization']


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''): h.update(block)
    return h.hexdigest()


def fetch(url, path, expected=None):
    if not path.exists():
        print('downloading', url, flush=True)
        urllib.request.urlretrieve(url, path)
    got = sha256(path)
    if expected and got != expected: sys.exit(f'{path.name}: SHA-256 {got} != pinned {expected}')
    return got


def stage_fetch(work):
    (work / 'ref').mkdir(parents=True, exist_ok=True); (work / 'samples').mkdir(exist_ok=True); (work / 'out').mkdir(exist_ok=True)
    record = {'official_onnx': {'url': ONNX_URL, 'sha256': fetch(ONNX_URL, work / 'official.onnx', ONNX_SHA), 'bytes': (work / 'official.onnx').stat().st_size}}
    for name, expected in HF_FILES.items(): record[name] = fetch(f'{HF}/{name}', work / 'ref' / name, expected)
    for name in SAMPLE_FILES: record[name] = fetch(f'{SAMPLES}/{name}', work / 'samples' / name)
    (work / 'out' / 'sources.json').write_text(json.dumps(record, indent=1))


def gate_images(work):
    from PIL import Image
    src = {p.stem: Image.open(p).convert('RGB') for p in sorted((work / 'samples').iterdir())}
    cat = src['chelsea'].crop((100, 20, 420, 300)).resize((260, 230))
    two = Image.new('RGB', (900, 420), (120, 140, 110)); two.paste(cat, (40, 90)); two.paste(cat.transpose(Image.FLIP_LEFT_RIGHT), (560, 120))
    src['composite-two-cats'] = two
    return src


def prep(img):
    import numpy as np
    from PIL import Image
    a = np.asarray(img.resize((SIZE, SIZE), Image.BILINEAR), np.float32) / 255
    return ((a - np.array(MEAN, np.float32)) / np.array(STD, np.float32)).transpose(2, 0, 1)[None].astype(np.float32)


def load_reference(work):
    sys.path.insert(0, str(work / 'ref'))
    from transformers import AutoModelForImageSegmentation
    return AutoModelForImageSegmentation.from_pretrained(str(work / 'ref'), trust_remote_code=True).eval().float()


def stage_ref(work):
    import numpy as np, torch
    model = load_reference(work)
    data = {}
    for name, img in gate_images(work).items():
        x = prep(img)
        with torch.no_grad(): r = model(torch.from_numpy(x))
        r = (r[-1] if isinstance(r, (list, tuple)) else r).sigmoid().numpy()[0, 0]
        data['x_' + name], data['r_' + name] = x, r.astype(np.float32)
        print(name, 'subject share', round(float((r >= 0.5).mean()), 3), flush=True)
    np.savez(work / 'ref.npz', **data)


def alpha_model(model):
    """The model returning the final soft mask (sigmoid applied), [1,1,S,S], as the app reads it."""
    import torch

    class Alpha(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_image):
            out = self.m(input_image)
            return (out[-1] if isinstance(out, (list, tuple)) else out).sigmoid()
    return Alpha(model).eval()


def patch_deform_conv():
    """Point every loaded copy of the model code at the pure-PyTorch deformable convolution."""
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    from deform_conv import deform_conv2d
    patched = [name for name, module in list(sys.modules.items())
               if module is not None and getattr(module, 'deform_conv2d', None) is not None and 'birefnet' in name.lower()]
    for name in patched:
        sys.modules[name].deform_conv2d = deform_conv2d
    return patched


def stage_export(work):
    import numpy as np, torch
    out = work / 'out'
    report = {}
    model = alpha_model(load_reference(work))
    ref = np.load(work / 'ref.npz')
    dummy = torch.zeros(1, 3, SIZE, SIZE)
    # 1. Native DeformConv attempt (opset 19), unpatched model. Recorded either way.
    native = out / 'birefnet-lite-deformconv-fp32.onnx'
    try:
        torch.onnx.export(model, (dummy,), str(native), input_names=['input_image'], output_names=['output_image'], opset_version=19, dynamo=False)
        report['native_deformconv_export'] = 'exported'
    except Exception as error:
        report['native_deformconv_export'] = f'failed: {type(error).__name__}: {str(error)[:300]}'
        if native.exists():
            native.unlink()
    # 2. Pure-PyTorch deformable convolution: prove it matches the real model, then export with standard ops.
    report['patched_modules'] = patch_deform_conv()
    worst = 0.0
    with torch.no_grad():
        for key in [k for k in ref.files if k.startswith('x_')]:
            got = model(torch.from_numpy(ref[key])).numpy()[0, 0]
            worst = max(worst, float(np.abs(got - ref['r_' + key[2:]]).max()))
    report['patched_pytorch_max_abs_diff'] = worst
    print('patched PyTorch vs reference, max |alpha diff|:', worst, flush=True)
    if not report['patched_modules'] or worst > 1e-3:
        sys.exit(f'pure-PyTorch deform conv does not match: {report}')
    torch.onnx.export(model, (dummy,), str(out / 'birefnet-lite-export-fp32.onnx'), input_names=['input_image'],
                      output_names=['output_image'], opset_version=17, dynamo=False)
    (out / 'export.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1), flush=True)


def stage_convert(work, source, stem):
    import numpy as np, onnx
    from onnx import TensorProto, helper, numpy_helper
    from onnxruntime.transformers.float16 import convert_float_to_float16
    official = pathlib.Path(source)
    onnx.save(convert_float_to_float16(onnx.load(str(official)), keep_io_types=True, op_block_list=KEEP_FP32), str(work / 'out' / f'{stem}-fp16.onnx'))
    # Weight-only fp16: every float initializer stored as fp16, cast back to fp32 before use.
    model = onnx.load(str(official)); g = model.graph; casts, keep = [], []
    for init in g.initializer:
        if init.data_type == TensorProto.FLOAT and int(np.prod(init.dims or [1])) >= 16:
            half = numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), init.name + '__fp16')
            keep.append(half); casts.append(helper.make_node('Cast', [half.name], [init.name], to=TensorProto.FLOAT, name=init.name + '__cast'))
        else:
            keep.append(init)
    del g.initializer[:]; g.initializer.extend(keep)
    nodes = list(g.node); del g.node[:]; g.node.extend(casts + nodes)
    onnx.save(model, str(work / 'out' / f'{stem}-w16.onnx'))


def stage_run(work, model_path, name):
    import numpy as np, onnxruntime as ort, psutil
    so = ort.SessionOptions(); so.enable_cpu_mem_arena = False; so.enable_mem_pattern = False
    started = time.perf_counter(); s = ort.InferenceSession(str(model_path), so, providers=['CPUExecutionProvider']); load_ms = (time.perf_counter() - started) * 1000
    ref = np.load(work / 'ref.npz')
    cases, ok, times, peak = {}, True, [], 0
    for key in [k for k in ref.files if k.startswith('x_')]:
        img = key[2:]; x, r = ref[key], ref['r_' + img]
        started = time.perf_counter(); o = s.run(None, {'input_image': x})[0][0, 0]; times.append((time.perf_counter() - started) * 1000)
        peak = max(peak, psutil.Process().memory_info().rss)
        if o.min() < 0 or o.max() > 1: o = 1 / (1 + np.exp(-o))
        band = (r > 0.05) & (r < 0.95); a, b = r >= 0.5, o >= 0.5
        union = (a | b).sum(); iou = float((a & b).sum() / union) if union else 1.0  # two empty masks agree
        mad = float(np.abs(o - r).mean())
        edge = float(np.abs(o - r)[band].mean()) if band.any() else 0.0
        passed = bool(mad <= 0.005 and iou >= 0.99 and edge <= 0.03); ok &= passed
        cases[img] = {'mean_abs_diff': round(mad, 5), 'iou': round(iou, 4), 'edge_band_diff': round(edge, 4), 'pass': passed}
    report = {'variant': name, 'file': model_path.name, 'bytes': model_path.stat().st_size, 'sha256': sha256(model_path),
              'result': 'PASS' if ok else 'FAIL', 'load_ms': round(load_ms), 'median_run_ms': round(float(np.median(times))),
              'peak_rss_mb': round(peak / 1e6), 'onnxruntime': ort.__version__, 'cases': cases}
    (work / 'out' / f'gate-{name}.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1), flush=True)


def main():
    stage, work = sys.argv[1], pathlib.Path(sys.argv[2]).resolve()
    if stage == 'fetch': return stage_fetch(work)
    if stage == 'ref': return stage_ref(work)
    if stage == 'export': return stage_export(work)
    if stage == 'convert': return stage_convert(work, sys.argv[3], sys.argv[4])
    if stage == 'run': return stage_run(work, pathlib.Path(sys.argv[3]), sys.argv[4])
    if stage == 'all':
        me = [sys.executable, '-I', __file__]
        for step in (['fetch'], ['ref'], ['export']):
            subprocess.run(me + step + [str(work)], check=True)
        exported = work / 'out' / 'birefnet-lite-export-fp32.onnx'
        subprocess.run(me + ['convert', str(work), str(exported), 'birefnet-lite'], check=True)
        variants = [(exported, 'export-fp32'), (work / 'out' / 'birefnet-lite-fp16.onnx', 'fp16'), (work / 'out' / 'birefnet-lite-w16.onnx', 'w16')]
        native = work / 'out' / 'birefnet-lite-deformconv-fp32.onnx'
        if native.exists():
            variants.append((native, 'native-deformconv-fp32'))
        summary = {}
        for path, name in variants:
            done = subprocess.run(me + ['run', str(work), str(path), name])
            gate = work / 'out' / f'gate-{name}.json'
            summary[name] = json.loads(gate.read_text())['result'] if done.returncode == 0 and gate.exists() else f'could not run (exit {done.returncode})'
        (work / 'out' / 'summary.json').write_text(json.dumps(summary, indent=1))
        print('SUMMARY', summary, flush=True)
        for big in (exported, native):  # fp32 copies: the gate reports keep their hashes; the artifact keeps the smaller variants
            if big.exists():
                big.unlink()
        return
    sys.exit(f'unknown stage {stage}')


if __name__ == '__main__':
    main()
