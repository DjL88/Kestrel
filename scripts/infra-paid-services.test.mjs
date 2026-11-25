// Paid Google APIs stay off until the owner approves them (owner decisions, 25 Nov 2026).
// Vertex AI may appear only in infra/gcp/vertex-learning.tf, behind a variable that defaults to false;
// Cloud Tasks may not appear at all, and no Vertex endpoint (an hourly bill) may ever be declared. A PR that enables either anywhere else fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('../infra/gcp/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.tf'));
// Comments may name a service; only configuration counts.
const code = (f) => readFileSync(join(dir, f), 'utf8').split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');

test('Vertex AI is enabled only by vertex-learning.tf, and only when the owner switches it on', () => {
  const users = files.filter((f) => code(f).includes('aiplatform.googleapis.com'));
  assert.deepEqual(users, ['vertex-learning.tf']);
  const tf = code('vertex-learning.tf');
  assert.match(tf, /variable "vertex_learning_enabled"\s*\{[^}]*default\s*=\s*false/s);
  assert.match(tf, /variable "vertex_learning_monthly_budget_gbp"\s*\{[^}]*default\s*=\s*0\b/s);
  const resource = tf.slice(tf.indexOf('resource "google_project_service" "vertex_learning"'));
  assert.match(resource, /count\s*=\s*var\.vertex_learning_enabled \? 1 : 0/);
  assert.match(resource, /precondition\s*\{[^}]*var\.vertex_learning_monthly_budget_gbp > 0/s);
});

test('Cloud Tasks is not enabled anywhere', () => {
  assert.deepEqual(files.filter((f) => code(f).includes('cloudtasks.googleapis.com')), []);
});

test('no Vertex endpoint, deployed model or always-on prediction resource exists anywhere (they bill hourly)', () => {
  for (const f of files) {
    assert.doesNotMatch(code(f), /resource\s+"google_vertex_ai_(endpoint|index_endpoint|deployment_resource_pool|feature_online_store|featurestore)/, f);
  }
});

test('the learning tick has no retries and runs hourly; the scheduler does not retry either', () => {
  const tf = code('vertex-learning.tf');
  assert.match(tf, /max_retries\s*=\s*0/);
  assert.match(tf, /retry_count\s*=\s*0/);
  assert.match(tf, /schedule\s*=\s*"17 \* \* \* \*"/);
});
