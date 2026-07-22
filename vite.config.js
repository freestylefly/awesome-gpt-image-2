import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localVercelApi } from './scripts/vite-local-api.mjs';

export default defineConfig({
  plugins: [localVercelApi(), react()],
  publicDir: 'data',
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
