import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dir,
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(dir, '..', 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
    modulePreload: false,
    chunkSizeWarningLimit: 8000,
  },
  worker: {
    format: 'es',
  },
});
