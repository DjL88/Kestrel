#!/usr/bin/env node
// The public website's address lives in one place: config/public-site.json. The app imports it (src/core/publicSite.ts),
// Terraform reads it (control-plane and models-bucket CORS) and the V2Proto gateway reads it (sign-in origin check).
// Static files that cannot import it (site HTML, sitemap, robots, the desktop link allow-list, the publish script) are
// listed in the same file and rewritten here.
//
//   node scripts/site/set-domain.mjs https://inflight.example     switch every listed file to the new origin
//   node scripts/site/set-domain.mjs --check                       fail if any listed file or src/ disagrees
//   --root=<dir>                                                    work on another checkout (tests)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootArg = args.find((a) => a.startsWith('--root='));
const root = rootArg ? rootArg.slice('--root='.length) : fileURLToPath(new URL('../../', import.meta.url));
const configPath = join(root, 'config', 'public-site.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

export function bareOrigin(value) {
  let url;
  try { url = new URL(String(value)); } catch { return null; }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
  return url.origin;
}

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function check() {
  const problems = [];
  const origin = bareOrigin(config.origin);
  if (!origin) problems.push(`config/public-site.json: origin ${JSON.stringify(config.origin)} is not a bare https origin`);
  for (const file of config.files) {
    const text = readFileSync(join(root, file), 'utf8');
    if (!text.includes(config.origin)) problems.push(`${file}: does not use ${config.origin}`);
    if (config.origin !== config.firebaseOrigin && text.includes(config.firebaseOrigin)) {
      problems.push(`${file}: still uses ${config.firebaseOrigin}`);
    }
  }
  for (const path of sourceFiles(join(root, 'src'))) {
    const text = readFileSync(path, 'utf8');
    for (const literal of new Set([config.origin, config.firebaseOrigin])) {
      if (text.includes(literal)) problems.push(`${relative(root, path)}: hard-codes ${literal}; use publicSiteUrl() from src/core/publicSite.ts`);
    }
  }
  return problems;
}

if (args.includes('--check')) {
  const problems = check();
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  console.log(`Public site origin ${config.origin}: ${config.files.length} files and src/ agree.`);
} else {
  const target = args.find((a) => !a.startsWith('--'));
  const next = bareOrigin(target);
  if (!next) {
    console.error('Usage: node scripts/site/set-domain.mjs https://your-domain.example (a bare https origin, no path)');
    process.exit(2);
  }
  const previous = config.origin;
  for (const file of config.files) {
    const path = join(root, file);
    const text = readFileSync(path, 'utf8');
    if (!text.includes(previous)) { console.error(`${file}: does not contain ${previous}; nothing changed`); process.exit(1); }
  }
  for (const file of config.files) {
    const path = join(root, file);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(previous, next));
  }
  config.origin = next;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`Public site origin: ${previous} -> ${next} (${config.files.length} files).`);
  console.log('Next: commit, rebuild the app, redeploy Hosting, and apply Terraform so CORS allows the new origin');
  console.log('(docs/ROADMAP.md, "Hosting on Google Cloud", custom domain checklist).');
}
