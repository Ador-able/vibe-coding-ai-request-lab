import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist/client', rolldownOptions: { input: ['index.html', 'context.html', 'quality.html'] } },
});
