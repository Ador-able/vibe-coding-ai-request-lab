import { build as buildClient } from 'vite';
import { build as buildServer } from 'esbuild';

await buildClient();
// 后端依赖随产物打包；直接启动只需要 Node.js。
await buildServer({
  entryPoints: ['src/server.ts'], outfile: 'runtime/server.mjs', bundle: true,
  platform: 'node', format: 'esm', target: 'node24', minify: true,
  external: ['vite'],
  banner: { js: "import { createRequire as createRuntimeRequire } from 'node:module'; const require = createRuntimeRequire(import.meta.url);" },
});
