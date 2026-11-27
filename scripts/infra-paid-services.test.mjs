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

test('the daily account deletion job is off unless the owner switches it on, and runs once a day', () => {
  const tf = code('account-deletions.tf');
  assert.match(tf, /variable "account_deletion_enabled"\s*\{[^}]*default\s*=\s*false/s);
  for (const r of tf.matchAll(/resource\s+"[^"]+"\s+"[^"]+"\s*\{\s*count\s*=\s*([^\n]+)/g)) assert.match(r[1], /^local\.account_deletion_enabled/);
  assert.match(tf, /schedule\s*=\s*"30 3 \* \* \*"/);
  assert.match(tf, /src\/runAccountDeletions\.ts/);
});

test('cloud edit settings (x-std-cloud-recipe) stay off until the owner switches them on, under a set spend ceiling', () => {
  const vars = code('variables.tf');
  assert.match(vars, /variable "cloud_recipe_enabled"\s*\{[^}]*default\s*=\s*false/s);
  assert.match(vars, /variable "monthly_spend_ceiling_pence"\s*\{[^}]*default\s*=\s*1500\b/s);
  const plane = code('control-plane.tf');
  assert.match(plane, /var\.cloud_processing_enabled && var\.cloud_runner_image != "" && var\.cloud_recipe_enabled \? \{ KCP_CLOUD_RECIPE_ENABLED = "1" \}/);
});

test('no image scanning service is enabled: Cloud Vision, PhotoDNA and the CyberTipline were removed (27 Nov 2026)', () => {
  for (const needle of ['vision.googleapis.com', 'safesearch', 'photodna', 'ncmec', 'safety_env']) {
    assert.deepEqual(files.filter((f) => code(f).toLowerCase().includes(needle)), [], needle);
  }
});

test('the compliance document bucket is off by default, private, versioned, never deletes, and the control plane cannot delete from it', () => {
  const tf = code('compliance.tf');
  assert.match(tf, /variable "compliance_documents_enabled"\s*\{[^}]*default\s*=\s*false/s);
  const bucket = tf.slice(tf.indexOf('resource "google_storage_bucket" "compliance"'), tf.indexOf('resource "google_storage_bucket_iam_member"'));
  assert.match(bucket, /count\s*=\s*var\.compliance_documents_enabled \? 1 : 0/);
  assert.match(bucket, /uniform_bucket_level_access\s*=\s*true/);
  assert.match(bucket, /public_access_prevention\s*=\s*"enforced"/);
  assert.match(bucket, /versioning\s*\{\s*enabled\s*=\s*true\s*\}/);
  assert.match(bucket, /prevent_destroy\s*=\s*true/);
  assert.match(bucket, /force_destroy\s*=\s*false/);
  assert.doesNotMatch(bucket, /lifecycle_rule|soft_delete_policy|retention_duration_seconds\s*=\s*0/);
  const roles = [...tf.matchAll(/roles\/storage\.[A-Za-z]+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(roles)].sort(), ['roles/storage.objectCreator', 'roles/storage.objectViewer']);
  assert.match(code('control-plane.tf'), /KCP_COMPLIANCE_BUCKET = try\(google_storage_bucket\.compliance\[0\]\.name, ""\)/);
  assert.match(readFileSync(join(dir, 'switch-features.sh'), 'utf8'), /"compliance_documents_enabled"/);
});

test('the retired one-off Pro price is never passed to the control plane (Pro is subscription only)', () => {
  for (const f of files) assert.doesNotMatch(code(f), /KCP_PADDLE_PRO_PRICE_ID/, f);
});
