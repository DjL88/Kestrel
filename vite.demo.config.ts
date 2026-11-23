import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Separate website entry points for the actual editors, not copies: demo-editor (the current PhotoEditor, still used by the
// owner's Demo Studio) and demo-v2 (the Version 2 workspace on fixed photographs, shown on the public homepage).
export default defineConfig({
  base: '/editor/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'site/editor',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: { input: { 'demo-editor': path.resolve(__dirname, 'demo-editor.html'), 'demo-v2': path.resolve(__dirname, 'demo-v2.html') } },
  },
});
