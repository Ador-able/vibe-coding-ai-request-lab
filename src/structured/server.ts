import express from 'express';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createStructuredApp() {
  const app = express(); app.disable('x-powered-by');
  app.get('/', (_req, res) => res.redirect('/structured.html'));
  return app;
}

async function start() {
  const app = createStructuredApp();
  if (process.argv.includes('--production')) app.use(express.static(resolve('dist/client')));
  else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true, ws: { host: '127.0.0.1' } }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  const server = app.listen(4319, '127.0.0.1', () => console.log('待办提取实验：http://127.0.0.1:4319/structured.html'));
  server.on('error', () => { console.error('4319服务启动失败，请检查该端口是否已占用。'); process.exit(1); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch(() => { console.error('启动失败，请确认依赖已安装。'); process.exit(1); });
}
