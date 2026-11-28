/**
 * Model files that must not be in any installer or web build (RED under the model licence policy of 28 Nov 2026; the
 * verdicts live in models/licences.json once the licence gate lands). They are removed from the built `models/` folder, so
 * a copy left in a developer's gitignored `public/models/` by an earlier build cannot ship by accident.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const RED_MODEL_FILES = [
  'bioclip-image-int8.onnx', 'bioclip.txt',
  'birefnet-lite-w16.onnx',
  'efficientsam-ti-encoder-fp16.onnx', 'efficientsam-ti-decoder-fp16.onnx',
  'species-world.json', 'species-mammals.json', 'species-reptiles.json', 'species-amphibians.json', 'species-odonata.json', 'species-lepidoptera.json',
];

export function removeRedModels(distDir) {
  const removed = [];
  for (const file of RED_MODEL_FILES) {
    const path = join(distDir, 'models', file);
    if (existsSync(path)) { rmSync(path, { force: true }); removed.push(file); }
  }
  return removed;
}

export const excludeRedModels = () => ({
  name: 'kestrel-exclude-red-models',
  apply: 'build',
  closeBundle() {
    const removed = removeRedModels('dist');
    if (removed.length) console.log(`Left out RED model files: ${removed.join(', ')}`);
  },
});
