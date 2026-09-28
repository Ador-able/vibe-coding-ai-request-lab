import express from 'express';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeUIMessageStreamToResponse } from 'ai';
import { createWorkflow } from './workflow.ts';
import type { RunRecord } from './contract.ts';

export function createStreamingApp(env: NodeJS.ProcessEnv = process.env) {
  const app = express(); app.disable('x-powered-by');
  app.use(express.json({ limit: '40kb' }));
  // 记录仅存活于本次服务进程，不承担会话存储或断线恢复。
  const runs = new Map<string, { record: RunRecord; controller: AbortController }>();
  app.get('/', (_req, res) => res.redirect('/streaming.html'));
  app.get('/api/streaming/info', (_req, res) => res.json({ model: env.MODEL?.trim() || '未配置' }));
  app.post('/api/streaming/run', async (req, res) => {
    const { runId, material } = req.body ?? {};
    if (typeof runId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(runId) || typeof material !== 'string' || !material.trim() || material.length > 6000) {
      res.status(400).json({ error: '请提供本次编号和1至6000字的工作纪要。' }); return;
    }
    if (runs.has(runId)) { res.status(409).json({ error: '此编号已有请求，请开始新的一次。' }); return; }
    const controller = new AbortController();
    const record: RunRecord = { id: runId, material, startedAt: new Date().toISOString(), state: 'running', durationMs: null, stages: [], uiEvents: [], finalMessage: null };
    runs.set(runId, { controller, record });
    const cancel = () => { if (!res.writableEnded && record.state === 'running') controller.abort(); };
    res.on('close', cancel);
    try {
      const stream = createWorkflow(record, env, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]));
      await pipeUIMessageStreamToResponse({ response: res, stream });
    } finally { cancel(); res.off('close', cancel); }
  });
  app.post('/api/streaming/:id/stop', (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) { res.status(404).json({ error: '未找到这次请求。' }); return; }
    if (run.record.state === 'running') run.controller.abort();
    res.json({ state: run.record.state });
  });
  app.get('/api/streaming/:id/record', (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) { res.status(404).json({ error: '记录不存在或服务已重启。' }); return; }
    res.json(run.record);
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (!res.headersSent) res.status(400).json({ error: '请求格式无效或超过大小限制。' });
    else res.end();
  });
  return app;
}
async function start() {
  const app = createStreamingApp();
  if (process.argv.includes('--production')) app.use(express.static(resolve('dist/client')));
  else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true, ws: { host: '127.0.0.1' } }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  const server = app.listen(4320, '127.0.0.1', () => console.log('文档助手：http://127.0.0.1:4320/streaming.html'));
  server.on('error', () => { console.error('4320服务启动失败，请检查端口是否已占用。'); process.exit(1); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch(() => { console.error('启动失败，请确认依赖已安装。'); process.exit(1); });
}
