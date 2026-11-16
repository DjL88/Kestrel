import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import type { BrowserPreviewProvider } from '../src/providers/browserPreviewProvider';
import type { loadExportSource, renderExport } from '../src/providers/browserExport';
import type { PhotoFrame } from '../src/core/types';

declare global {
  interface Window {
    developedPreviewTest: {
      BrowserPreviewProvider: typeof BrowserPreviewProvider;
      loadExportSource: typeof loadExportSource;
      renderExport: typeof renderExport;
    };
  }
}

let bundle: string;
test.beforeAll(async () => {
  const provider = fileURLToPath(new URL('../src/providers/browserPreviewProvider.ts', import.meta.url));
  const exporter = fileURLToPath(new URL('../src/providers/browserExport.ts', import.meta.url));
  const entry = fileURLToPath(new URL('./developed-preview-entry.ts', import.meta.url));
  const result = await build({
    configFile: false, logLevel: 'silent',
    plugins: [{
      name: 'developed-preview-test-entry',
      enforce: 'pre',
      resolveId(id) { if (id === entry) return '\0developed-preview-test'; },
      load(id) {
        if (id === '\0developed-preview-test') return `export { BrowserPreviewProvider } from ${JSON.stringify(provider)}; export { loadExportSource, renderExport } from ${JSON.stringify(exporter)};`;
      },
    }],
    build: {
      write: false, minify: false,
      lib: { entry, name: 'developedPreviewTest', formats: ['iife'] },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result) as { output: { type: string; code?: string }[] };
  bundle = output.output.find((item) => item.type === 'chunk')!.code!;
});

test('a virtual copy exports the newly developed pixels at full source dimensions', async ({ page }) => {
  // Real browser decoding and PNG export, using generated pixels only. This does not validate a Nikon decoder.
  await page.route('**/developed-preview-test', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Developed preview test</title>' }));
  await page.goto('/developed-preview-test');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const { BrowserPreviewProvider, loadExportSource, renderExport } = window.developedPreviewTest;
    const provider = new BrowserPreviewProvider();
    const canvas = document.createElement('canvas');
    const encode = (type: string) => new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), type, 1));
    canvas.width = 512; canvas.height = 384;
    const context = canvas.getContext('2d')!;
    for (let y = 0; y < canvas.height; y += 5) for (let x = 0; x < canvas.width; x += 5) {
      context.fillStyle = (x + y) % 10 ? '#a04820' : '#2084a0';
      context.fillRect(x, y, 5, 5);
    }
    const embedded = await encode('image/jpeg');
    const original = new Blob([new Uint8Array(64), embedded]);
    const originalBytes = new Uint8Array(await original.arrayBuffer());
    const frame: PhotoFrame = {
      id: 'original', stableKey: 'generated-nef', filename: 'synthetic-Z8.NEF', sequenceIndex: 1,
      decision: 'keep', burstGroupId: null, burstIndex: 1, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
    };
    const copy = { ...frame, id: 'copy', virtualCopy: { originalFrameId: frame.id, number: 1 } };
    try {
      provider.registerBlob(frame.stableKey, original);
      const before = await loadExportSource(copy, provider);
      canvas.width = 768; canvas.height = 512;
      context.fillStyle = '#3296c8'; context.fillRect(0, 0, canvas.width, canvas.height);
      provider.setDeveloped(frame, await encode('image/png'));
      const source = await loadExportSource(copy, provider);
      const file = await renderExport(source, copy, {
        id: 'master', label: 'Full size', prefix: '', width: 0, height: 0, quality: 1, format: 'png',
      }, new Date('2026-11-16T00:00:00Z'));
      const output = await createImageBitmap(file);
      canvas.width = output.width; canvas.height = output.height;
      context.drawImage(output, 0, 0);
      const pixel = Array.from(context.getImageData(100, 100, 1, 1).data);
      const dimensions = [output.width, output.height];
      output.close();
      const retained = new Uint8Array(await provider.getOriginal(frame.stableKey)!.arrayBuffer());
      return {
        before: [before.naturalWidth, before.naturalHeight], dimensions, pixel,
        originalUnchanged: retained.length === originalBytes.length && retained.every((value, i) => value === originalBytes[i]),
      };
    } finally { provider.clear(); }
  });
  expect(result.before).toEqual([512, 384]);
  expect(result.dimensions).toEqual([768, 512]);
  expect(result.pixel).toEqual([50, 150, 200, 255]);
  expect(result.originalUnchanged).toBe(true);
});
