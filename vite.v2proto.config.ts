import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Unlike the public demo, this builds the REAL workspace. Every compiled
// /V2Proto/ asset must be served by the authenticated Cloud Run gateway.
export default defineConfig({
  base: '/V2Proto/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'out/v2proto',
    emptyOutDir: true,
    rollupOptions: { input: { index: path.resolve(__dirname, 'v2-proto.html') } },
  },
});
