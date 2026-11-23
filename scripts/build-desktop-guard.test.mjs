import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReleaseBuildArgs, assertChildSucceeded } from './build-desktop-guard.mjs';

test('normal release arguments are accepted', () => {
  assert.doesNotThrow(() => assertReleaseBuildArgs([]));
  assert.doesNotThrow(() => assertReleaseBuildArgs(['--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis']));
});
test('debug and custom profile builds fail closed', () => {
  for (const args of [['--debug'], ['-d'], ['--debug=true'], ['--profile', 'dev'], ['--profile=custom']]) {
    assert.throws(() => assertReleaseBuildArgs(args), /release|profiles/);
  }
});
test('child success requires clean zero exit', () => {
  assert.doesNotThrow(() => assertChildSucceeded({status:0,signal:null,error:undefined}, 'build'));
  for (const result of [{status:1}, {status:null}, {status:null,signal:'SIGTERM'}, {status:null,error:new Error('ENOENT')}]) {
    assert.throws(() => assertChildSucceeded(result, 'build'), /build/);
  }
});
