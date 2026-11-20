import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { planBackupRestore, safeBackupPath, verifyBackupRestore, type BackupManifest } from './backupRestoreProof';

const bytes = new TextEncoder().encode('original pixels stay unchanged');
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const entry = (path: string) => ({ path, byteLength: bytes.length, sha256: digest(bytes) });
const manifest = (...paths: string[]): BackupManifest => ({
  format: 'kestrel-portable-backup', version: 1, entries: paths.map(entry),
});
const adapter = (paths: string[], payload = bytes) => ({
  listPaths: async () => paths,
  readFile: async () => payload,
  sha256: async (data: Uint8Array) => digest(data),
});

describe('portable backup restore proof', () => {
  it('accepts an exact digest-verified relative archive and never writes', async () => {
    const plan = await verifyBackupRestore(manifest('originals/bird.nef'), adapter(['originals/bird.nef']));
    expect(plan[0].relativePath).toBe('originals/bird.nef');
    expect(Object.isFrozen(plan)).toBe(true);
  });
  it.each(['../escape', '/etc/passwd', 'C:/escape', 'a//b', 'a/./b',
    'a/../b', 'a\\b', 'a/CON', 'a/b.', 'a/b ', 'a:b', 'a/\u0000'])(
    'rejects unsafe path %s', path => expect(() => safeBackupPath(path)).toThrow('unsafe-backup-path'));
  it('rejects case-insensitive aliases and file/directory conflicts', () => {
    expect(() => planBackupRestore(manifest('A/Photo.NEF', 'a/photo.nef'))).toThrow('duplicate-backup-path');
    expect(() => planBackupRestore(manifest('a', 'a/b'))).toThrow('backup-file-directory-collision');
  });
  it('rejects malformed length, digest and version', () => {
    expect(() => planBackupRestore({ ...manifest('a'), version: 2 } as unknown as BackupManifest)).toThrow();
    expect(() => planBackupRestore({ ...manifest('a'), entries: [{ ...entry('a'), byteLength: -1 }] })).toThrow();
    expect(() => planBackupRestore({ ...manifest('a'), entries: [{ ...entry('a'), sha256: 'no' }] })).toThrow();
  });
  it('rejects missing, extra and aliased archive entries', async () => {
    await expect(verifyBackupRestore(manifest('a'), adapter([]))).rejects.toThrow('backup-entry-set-mismatch');
    await expect(verifyBackupRestore(manifest('a'), adapter(['a', 'extra']))).rejects.toThrow('backup-entry-set-mismatch');
    await expect(verifyBackupRestore(manifest('a'), adapter(['a', 'A']))).rejects.toThrow('duplicate-archive-entry');
  });
  it('rejects byte length and SHA mismatches', async () => {
    await expect(verifyBackupRestore(manifest('a'), adapter(['a'], new Uint8Array([1])))).rejects.toThrow('backup-content-mismatch');
    await expect(verifyBackupRestore(manifest('a'), adapter(['a'], new Uint8Array(bytes.length)))).rejects.toThrow('backup-content-mismatch');
  });
  it('fails closed on cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(verifyBackupRestore(manifest('a'), adapter(['a']), controller.signal)).rejects.toThrow('restore-cancelled');
  });
});
