import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import type { directoryHandleConnector } from '../src/providers/folderConnector';

declare global {
  interface Window { folderRecoveryTest: { directoryHandleConnector: typeof directoryHandleConnector } }
}
let bundle: string;
test.beforeAll(async () => {
  const entry = fileURLToPath(new URL('../src/providers/folderConnector.ts', import.meta.url));
  const result = await build({ configFile: false, logLevel: 'silent', build: {
    write: false, minify: false, lib: { entry, name: 'folderRecoveryTest', formats: ['iife'] },
  } });
  const output = (Array.isArray(result) ? result[0] : result) as { output: { type: string; code?: string }[] };
  bundle = output.output.find((item) => item.type === 'chunk')!.code!;
});

for (const failure of ['write', 'close'] as const) {
  test(`failed folder ${failure} preserves a real browser file and permits a retry`, async ({ page }) => {
    await page.route('**/folder-recovery-test', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Folder recovery test</title>' }));
    await page.goto('/folder-recovery-test');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(async (failure) => {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle('synthetic-backup-recovery', { create: true });
      const path = 'kestrel/v1/backups/test/snapshot.kestrel.json';
      const { directoryHandleConnector } = window.folderRecoveryTest;
      const clean = directoryHandleConnector(folder);
      const encode = (text: string) => new TextEncoder().encode(text);
      // Fault injection wraps actual browser filesystem handles, not the stored data.
      function interrupted(handle: FileSystemDirectoryHandle): FileSystemDirectoryHandle {
        return {
          async getDirectoryHandle(name: string, options: FileSystemGetDirectoryOptions) {
            return interrupted(await handle.getDirectoryHandle(name, options));
          },
          async getFileHandle(name: string, options: FileSystemGetFileOptions) {
            const file = await handle.getFileHandle(name, options);
            return { async createWritable() {
              const stream = await file.createWritable();
              return {
                async write(data: BufferSource) { await stream.write(data); if (failure === 'write') throw new Error('Synthetic interruption'); },
                async close() { if (failure === 'close') throw new Error('Synthetic interruption'); await stream.close(); },
                async abort() { await stream.abort(); },
              };
            } };
          },
        } as unknown as FileSystemDirectoryHandle;
      }
      try {
        await clean.put(path, encode('Complete earlier backup'), '');
        let message = '';
        try { await directoryHandleConnector(interrupted(folder)).put(path, encode('Interrupted replacement'), ''); }
        catch (error) { message = (error as Error).message; }
        const retained = new TextDecoder().decode((await clean.get(path))!);
        await clean.put(path, encode('Complete retry'), '');
        return { message, retained, retried: new TextDecoder().decode((await clean.get(path))!) };
      } finally { await root.removeEntry('synthetic-backup-recovery', { recursive: true }); }
    }, failure);
    expect(result).toEqual({ message: 'Synthetic interruption', retained: 'Complete earlier backup', retried: 'Complete retry' });
  });
}
