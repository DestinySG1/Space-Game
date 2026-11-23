import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` emits one self-contained dist/index.html that runs anywhere.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
});
