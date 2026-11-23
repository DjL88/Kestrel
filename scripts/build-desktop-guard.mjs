/** Release-only desktop build gate; intentionally pure for deterministic tests. */
export function assertReleaseBuildArgs(args) {
  for (const arg of args) {
    if (arg === '--debug' || arg.startsWith('--debug=') || arg === '-d') {
      throw new Error('Desktop installer must be an optimised release build (debug mode refused).');
    }
    if (arg === '--profile' || arg.startsWith('--profile=')) {
      throw new Error('Custom desktop build profiles are not verified release builds.');
    }
  }
}
export function assertChildSucceeded(result, step) {
  if (result.error) throw new Error(step + ' could not start: ' + result.error.message);
  if (result.signal) throw new Error(step + ' terminated by signal ' + result.signal);
  if (result.status !== 0) throw new Error(step + ' failed with exit status ' + String(result.status));
}
