/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` emits one self-contained dist/index.html that runs anywhere.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  // `npm run dev` talks to a local game server (cd server && npm run dev) for accounts and cloud saves
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: { include: ['tests/**/*.test.ts'] },
});
