import express from 'express';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractTasks, modelName } from './request.ts';
import { JSON_SCHEMA } from './schema.ts';
import { MODES, type Mode, type StructuredResponse } from './contract.ts';

export function createStructuredApp(env: NodeJS.ProcessEnv = process.env) {
  const app = express(); app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.get('/', (_req, res) => res.redirect('/structured.html'));
  app.get('/api/structured/info', (_req, res) => res.json({ model: modelName(env), schema: JSON_SCHEMA }));
  app.post('/api/structured/extract', async (req, res) => {
    const { material, mode } = req.body ?? {};
    if (typeof material !== 'string' || !material.trim() || material.length > 5000 || typeof mode !== 'string' || !Object.hasOwn(MODES, mode)) {
      res.status(400).json({ error: '请选择输出方式，并输入1至5000字的会议纪要。' }); return;
    }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    try {
      const run = await extractTasks(material, mode as Mode, env, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]));
      if (!res.destroyed) res.status(run.error ? 502 : 200).json({ ok: !run.error, run } satisfies StructuredResponse);
    } finally { res.off('close', cancel); }
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: '请求格式无效或超过大小限制，没有取得提取结果。' });
  });
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
