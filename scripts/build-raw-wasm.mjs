#!/usr/bin/env node
// Builds Kestrel's RAW pipeline (crates/kestrel-raw) as WebAssembly for the web app and copies it to
// src/assets/wasm/kestrel_raw.wasm. Needs Rust with the wasm32-wasip1 target (rustup target add wasm32-wasip1).
// One decoder for every platform: the binary includes Nikon High Efficiency (HE/HE*) decoding, as the desktop app does
// (owner decision, 19 Nov 2026; NOTICE.md). Pass --without-nikon-he for a binary without it.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const withoutHe = process.argv.includes('--without-nikon-he');
const manifest = 'crates/kestrel-raw-wasm/Cargo.toml';
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-wasip1', '--manifest-path', manifest,
  ...(withoutHe ? ['--no-default-features'] : [])], { stdio: 'inherit' });
const built = 'crates/kestrel-raw-wasm/target/wasm32-wasip1/release/kestrel_raw_wasm.wasm';
mkdirSync('src/assets/wasm', { recursive: true });
copyFileSync(built, 'src/assets/wasm/kestrel_raw.wasm');
const bytes = readFileSync('src/assets/wasm/kestrel_raw.wasm');
console.log(`src/assets/wasm/kestrel_raw.wasm: ${bytes.length} bytes, SHA-256 ${createHash('sha256').update(bytes).digest('hex')}${withoutHe ? ' (without Nikon HE)' : ''}`);
