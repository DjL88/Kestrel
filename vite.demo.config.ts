import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// A separate website entry point for the actual React PhotoEditor, not a copy of the editor.
export default defineConfig({
  base: '/editor/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'site/editor',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: { input: path.resolve(__dirname, 'demo-editor.html') },
  },
});
