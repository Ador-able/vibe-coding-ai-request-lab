import express from 'express';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createMessagesApp() {
  const app = express(); app.disable('x-powered-by');
  app.get('/', (_req, res) => res.redirect('/messages.html'));
  return app;
}
async function start() {
  const app = createMessagesApp();
  if (process.argv.includes('--production')) app.use(express.static(resolve('dist/client')));
  else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true, ws: { host: '127.0.0.1' } }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  const server = app.listen(4321, '127.0.0.1', () => console.log('纪要对话：http://127.0.0.1:4321/messages.html'));
  server.on('error', () => { console.error('4321服务启动失败，请检查端口是否已占用。'); process.exit(1); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch(() => { console.error('启动失败，请确认依赖已安装。'); process.exit(1); });
}
