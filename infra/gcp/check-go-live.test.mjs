// infra/gcp/check-go-live.sh against fake gcloud, curl and git: the right OK / OFF / MISSING lines, and never a secret.
// Needs bash and jq (Cloud Shell and CI have both); skipped where either is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-go-live.sh', import.meta.url));
const has = (cmd) => spawnSync('bash', ['-c', `command -v ${cmd}`]).status === 0;
const skip = process.platform === 'win32' || !has('jq') ? 'needs bash and jq (Linux, Cloud Shell, CI)' : false;

const SECRET_VALUE = 'pdl_live_apikey_DO_NOT_PRINT';
const CLIENT_TOKEN = 'live_clienttoken_DO_NOT_PRINT';
const MAIN = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

function rig({ healthy = true, manifestKey = 'kestrel-2026-11', paddle = true, secrets = ['kestrel-paddle-api-key', 'kestrel-paddle-webhook-secret', 'kestrel-paddle-client-token'], tfvars = {}, triggerSubs = {}, domains = ['kestrel-hosting-kestrel.web.app'], rtdb = true, fcm = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'golive-'));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const live = join(dir, 'live'); mkdirSync(live);
  const repo = join(dir, 'repo'); mkdirSync(join(repo, '.git'), { recursive: true }); mkdirSync(join(repo, 'config'));
  writeFileSync(join(repo, 'config', 'public-site.json'), JSON.stringify({ origin: 'https://kestrel-hosting-kestrel.web.app', plannedOrigin: 'https://inflight.studio' }));
  writeFileSync(join(live, 'current.tfvars.json'), JSON.stringify({ project_id: 'kestrel-hosting', firebase_project_id: 'kestrel-photo', ...tfvars }));
  const tool = (name, body) => { const p = join(bin, name); writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`); chmodSync(p, 0o755); };
  tool('gcloud', `
args="$*"
case "$args" in
  "auth print-access-token"*) echo "ya29.TOKEN_DO_NOT_PRINT";;
  *"run services describe kestrel-control-plane"*"status.url"*) echo "https://cp.example.test";;
  *"run services describe kestrel-control-plane"*"image"*) echo "europe-west2-docker.pkg.dev/kestrel-hosting/kestrel/control-plane:${OLD}";;
  *"run services describe inflight-v2proto"*) echo "europe-west2-docker.pkg.dev/kestrel-hosting/inflight/v2proto:${MAIN.slice(0, 7)}";;
  *"secrets describe"*) for s in ${secrets.join(' ')}; do [[ "$args" == *"describe $s "* ]] && { echo "projects/x/secrets/$s"; exit 0; }; done; exit 1;;
  *"secrets versions list"*) echo "1"; echo "2";;
  *"secrets versions access"*) echo "${SECRET_VALUE}";;
  *"services list"*) ${fcm ? 'echo fcm.googleapis.com' : 'true'};;
  *"builds triggers list"*) echo '[{"filename":".cloudbuild/v2proto.yaml","substitutions":${JSON.stringify(triggerSubs)}}]';;
  *) exit 1;;
esac`);
  tool('curl', `
url=""; code=0; for a in "$@"; do case "$a" in http*) url="$a";; '%{http_code}') code=1;; esac; done
body=""; status=200
case "$url" in
  */health) ${healthy ? 'body=\'{"ok":true}\'' : 'status=503'};;
  */v1/models/manifest) ${manifestKey ? `body='{"keyId":"${manifestKey}","payload":{"schema":1,"revision":2,"assets":[1,2,3]}}'` : `body='{"error":{"code":"MANIFEST_NOT_CONFIGURED"}}'; status=503`};;
  */v1/billing/paddle/config) ${paddle ? `body='{"environment":"production","clientToken":"${CLIENT_TOKEN}"}'` : `body='{"error":{"code":"CHECKOUT_DISABLED"}}'; status=503`};;
  *identitytoolkit*) body='{"authorizedDomains":${JSON.stringify(domains)}}';;
  *firebasedatabase*) ${rtdb ? 'body=\'{"instances":[{"name":"projects/1/locations/europe-west1/instances/kestrel-photo-default-rtdb"}]}\'' : "body='{}'"};;
  *) status=404;;
esac
if [[ $code == 1 ]]; then echo -n "$status"; else echo -n "$body"; fi`);
  tool('git', `
case "$*" in
  *"rev-parse origin/main"*) echo "${MAIN}";;
  *"rev-list --count"*) echo 7;;
  *) true;;
esac`);
  return { run: () => execFileSync('bash', [script, repo, live], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: dir }, encoding: 'utf8' }) };
}

const line = (out, what) => out.split('\n').find((l) => l.includes(what + ':')) ?? '';

test('a ready backend reads OK line by line, with the next step where something is behind', { skip }, () => {
  const out = rig({
    secrets: ['kestrel-paddle-api-key', 'kestrel-paddle-webhook-secret', 'kestrel-paddle-client-token', 'kcp-smtp-hello-app-password', 'kestrel-manifest-signing-key'],
    tfvars: { collaboration_enabled: true, gallery_enabled: true, cloud_photos_enabled: true, push_enabled: true, smtp_mail_enabled: true, phase5_paddle_enabled: true, phase5_paddle_environment: 'production', presence_database_url: 'https://kestrel-photo-default-rtdb.europe-west1.firebasedatabase.app' },
    triggerSubs: { _CONTROL_PLANE_URL: 'https://cp.example.test', _GRANT_KEYS: 'kcp-2026-11=x', _FIREBASE_API_KEY: 'AIza' },
    domains: ['kestrel-hosting-kestrel.web.app', 'inflight.studio'], fcm: true,
  }).run();
  assert.match(line(out, 'Control plane'), /^OK +Control plane: answers \/health; image b{40} \(7 commit\(s\) behind origin\/main\)/);
  assert.match(out, /Next: redeploy with deploy-control-plane\.sh/);
  assert.match(line(out, 'Model manifest'), /^OK .*key kestrel-2026-11, revision 2, 3 file\(s\)/);
  assert.match(line(out, 'Paddle checkout'), /^OK .*environment production, client token present/);
  assert.match(line(out, 'Secret kcp-smtp-hello-app-password'), /^OK .*exists, 2 enabled version\(s\)/);
  assert.match(line(out, 'Switch push_enabled'), /^OK +Switch push_enabled: on/);
  assert.match(line(out, 'V2 web build _CONTROL_PLANE_URL'), /^OK/);
  assert.match(line(out, 'Firebase sign-in domain inflight.studio'), /^OK/);
  assert.match(line(out, 'Realtime Database kestrel-photo-default-rtdb'), /^OK/);
  assert.match(out, /Summary: \d+ OK, 0 OFF, 0 MISSING\. Nothing was changed\./);
});

test('what is missing or off says so, with the next step, and no secret or token is ever printed', { skip }, () => {
  const out = rig({ manifestKey: null, paddle: false, rtdb: false, domains: ['localhost'] }).run();
  assert.match(line(out, 'Model manifest'), /^MISSING .*MANIFEST_NOT_CONFIGURED/);
  assert.match(line(out, 'Paddle checkout'), /^OFF .*CHECKOUT_DISABLED/);
  assert.match(line(out, 'Secret kcp-smtp-hello-app-password'), /^MISSING .*does not exist/);
  assert.match(line(out, 'Switch collaboration_enabled'), /^OFF/);
  assert.match(line(out, 'Push (FCM API)'), /^OFF/);
  assert.match(line(out, 'V2 web build _CONTROL_PLANE_URL'), /^MISSING .*built without the control-plane URL/);
  assert.match(line(out, 'Firebase sign-in domain kestrel-hosting-kestrel.web.app'), /^MISSING/);
  assert.match(line(out, 'Firebase sign-in domain inflight.studio'), /^OFF .*planned/);
  assert.match(line(out, 'Realtime Database kestrel-photo-default-rtdb'), /^MISSING .*Next|^MISSING/);
  assert.match(out, /Next: create it in Firebase console → Realtime Database/);
  for (const secret of [SECRET_VALUE, CLIENT_TOKEN, 'ya29.TOKEN_DO_NOT_PRINT']) assert.equal(out.includes(secret), false, secret);
});

test('the script only reads: no apply, deploy, create, update, delete or secret access anywhere in it', () => {
  const source = execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(script)}, 'utf8'))`], { encoding: 'utf8' });
  const commands = source.split('\n').filter((l) => !l.trim().startsWith('#') && !/say |Next|echo /.test(l)).join('\n');
  for (const bad of [/terraform\s+apply/, /gcloud[^\n]*\b(deploy|create|update|delete|add-iam|set-iam)\b/, /versions access/, /-X\s*(POST|PUT|PATCH|DELETE)/, /--request\s*(POST|PUT|PATCH|DELETE)/]) {
    assert.doesNotMatch(commands, bad);
  }
});
