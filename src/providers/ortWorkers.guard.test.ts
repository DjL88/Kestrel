import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Guard for the packaged desktop app's model hang (27 Nov 2026): in Tauri's own protocol a worker started from inside a
 * worker cannot load the app's files, so onnxruntime's thread workers never start and a model in a worker waits for ever
 * at 0% CPU. Tests served over http cannot see that, so this pins the rule instead: every worker that loads onnxruntime
 * takes its thread count from the page's worker plan (one thread in the desktop app, ortWorkerPlanFor) or fixes it at
 * one, and the page only ever hands workers a plan made by ortPlanForWorkers.
 */
const dir = new URL('./', import.meta.url);
const sources = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => ({ name, text: readFileSync(new URL(name, dir), 'utf8') }));

test('every model worker takes its onnxruntime threads from the worker plan, or uses one', () => {
  const workers = sources.filter(({ name, text }) => /Worker\.ts$/.test(name) && /onnxruntime-web|loadOrt\(/.test(text));
  assert.ok(workers.length >= 4, `found the model workers (${workers.map((w) => w.name).join(', ')})`);
  for (const { name, text } of workers) {
    const fromPlan = /readOrtPlan\(/.test(text) && /loadOrt\(\s*plan\s*\)/.test(text);
    const single = /numThreads\s*=\s*1\b/.test(text) && !/numThreads\s*=\s*(?!1\b)/.test(text.replace(/numThreads\s*=\s*1\b/g, ''));
    assert.ok(fromPlan || single, `${name} must use the page's worker plan (readOrtPlan) or one thread`);
  }
});

test('the page hands model workers only plans made for workers', () => {
  for (const { name, text } of sources) {
    for (const match of text.matchAll(/type:\s*'init'[^}]*?\bort:\s*([^,}]+)/g)) {
      const value = match[1].trim();
      // Either the call itself, or a name the file sets from it (`const plan = ortPlanForWorkers(count)`).
      const fromName = /^\w+$/.test(value) && new RegExp(`\\b${value}\\s*=\\s*ortPlanForWorkers\\(`).test(text);
      assert.ok(/^ortPlanForWorkers\(/.test(value) || fromName, `${name}: a worker's plan must come from ortPlanForWorkers, not ${value}`);
    }
  }
});

test('ortPlanForWorkers makes worker plans with the worker rule (one thread in the desktop app)', () => {
  const runtime = sources.find(({ name }) => name === 'ortRuntime.ts')!.text;
  assert.match(runtime, /export function ortPlanForWorkers\([^)]*\): OrtPlan \{ return planHere\(\w+, true\); \}/);
  assert.match(runtime, /\(inWorker \? ortWorkerPlanFor : ortPlanFor\)/);
});
