import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist/client', rolldownOptions: { input: ['index.html', 'context.html', 'quality.html', 'memory.html', 'latency.html', 'collaboration.html', 'decisions.html', 'feedback.html', 'structured.html', 'streaming.html', 'messages.html'] } },
});
