#!/usr/bin/env node
/**
 * Regression for AI Studio / partial GitHub imports: large ONNX assets may be
 * absent from an IDE preview. Vite must still compile the photo editor.
 *
 * Run only in an isolated CI/developer checkout. The source directory is
 * renamed briefly and restored in finally; no model bytes are modified.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const models = join(root, 'src', 'assets', 'models');
const hidden = join(root, 'src', 'assets', 'models.kestrel-preview-test-hidden');
const out = mkdtempSync(join(tmpdir(), 'kestrel-preview-no-models-'));

if (existsSync(hidden)) {
  console.error('Refusing to run: an earlier hidden-model folder already exists.');
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}

let moved = false;
try {
  if (existsSync(models)) {
    renameSync(models, hidden);
    moved = true;
  }
  console.log('Building the real Kestrel app with the ONNX directory absent, as in AI Studio...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = spawnSync(npm, ['run', 'build', '--', '--outDir', out, '--emptyOutDir'], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32', timeout: 180_000,
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`Kestrel preview failed without model files (exit ${build.status}).`);
  console.log('PASS: Kestrel builds without either ONNX model; full installs still use verified bundled assets.');
} finally {
  if (moved) renameSync(hidden, models);
  rmSync(out, { recursive: true, force: true });
}
