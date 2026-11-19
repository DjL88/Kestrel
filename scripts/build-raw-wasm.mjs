#!/usr/bin/env node
// Builds Kestrel's RAW pipeline (crates/kestrel-raw) as WebAssembly for the web app and copies it to
// src/assets/wasm/kestrel_raw.wasm. Needs Rust with the wasm32-wasip1 target (rustup target add wasm32-wasip1).
// The committed web binary is built WITHOUT the patented Nikon High Efficiency codec, because serving the web app is
// distribution (NOTICE.md, docs/COMMERCIAL-RELEASE.md). Pass --with-nikon-he only for a private, local build.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const withoutHe = !process.argv.includes('--with-nikon-he');
const manifest = 'crates/kestrel-raw-wasm/Cargo.toml';
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-wasip1', '--manifest-path', manifest,
  ...(withoutHe ? [] : ['--features', 'nikon-he'])], { stdio: 'inherit' });
const built = 'crates/kestrel-raw-wasm/target/wasm32-wasip1/release/kestrel_raw_wasm.wasm';
mkdirSync('src/assets/wasm', { recursive: true });
copyFileSync(built, 'src/assets/wasm/kestrel_raw.wasm');
const bytes = readFileSync('src/assets/wasm/kestrel_raw.wasm');
console.log(`src/assets/wasm/kestrel_raw.wasm: ${bytes.length} bytes, SHA-256 ${createHash('sha256').update(bytes).digest('hex')}${withoutHe ? ' (without Nikon HE)' : ''}`);
