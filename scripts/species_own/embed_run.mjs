// Runs the SHIPPED DINOv2 ViT-S/14 fp16 ONNX with the same runtime the app uses (onnxruntime-web, WASM), on 224x224
// RGB uint8 crops written by embed.py. (The Python onnxruntime CPU build returns inf for this fp16 model, so it is not used.)
// Usage: node embed_run.mjs <model.onnx> <crops.u8> <count> <out.f32>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const ort = await import(path.resolve(here, '../../node_modules/onnxruntime-web/dist/ort.node.min.mjs'));
const [, , modelPath, cropsPath, countArg, outPath] = process.argv;
const count = Number(countArg);
const crops = fs.readFileSync(cropsPath);
const session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(modelPath)), { executionProviders: ['wasm'] });
const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
const plane = 224 * 224;
const out = new Float32Array(count * 384);
for (let n = 0; n < count; n += 1) {
  const input = new Float32Array(3 * plane);
  const base = n * plane * 3;
  for (let i = 0; i < plane; i += 1) for (let c = 0; c < 3; c += 1) input[c * plane + i] = (crops[base + i * 3 + c] / 255 - mean[c]) / std[c];
  const result = await session.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, 224, 224]) });
  out.set(result.embedding.data, n * 384);
}
fs.writeFileSync(outPath, Buffer.from(out.buffer));
