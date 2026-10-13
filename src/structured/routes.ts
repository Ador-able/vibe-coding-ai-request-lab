import express from 'express';
import { extractTasks, modelName } from './request.ts';
import { JSON_SCHEMA } from './schema.ts';
import { MODES, type Mode, type StructuredResponse } from './contract.ts';

export function createStructuredRouter(env: NodeJS.ProcessEnv) {
  const app = express.Router();
  app.use(express.json({ limit: '32kb' }));
  app.get('/info', (_req, res) => res.json({ model: modelName(env), schema: JSON_SCHEMA }));
  app.post('/extract', async (req, res) => {
    const { material, mode } = req.body ?? {};
    if (typeof material !== 'string' || !material.trim() || material.length > 5000 || typeof mode !== 'string' || !Object.hasOwn(MODES, mode)) {
      res.status(400).json({ error: '请选择输出方式，并输入1至5000字的小说资料。' }); return;
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
