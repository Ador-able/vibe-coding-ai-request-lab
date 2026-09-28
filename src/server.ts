import express from 'express';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { askModel, ModelError, readConfig } from './model.ts';
import type { AskPayload, AskResult, RequestTrace, Stage } from './contract.ts';

export function createApp(env: NodeJS.ProcessEnv = process.env, log = console.log) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.post('/api/ask', async (req, res) => {
    const beganAt = performance.now();
    const trace: RequestTrace = { requestId: randomUUID(), model: null, stages: [] };
    const record = (name: Stage['name'], detail: string) => {
      const stage = { name, elapsedMs: Math.round(performance.now() - beganAt), detail };
      trace.stages.push(stage);
      log(JSON.stringify({ requestId: trace.requestId, ...stage }));
    };
    const reply = (status: number, body: AskPayload) => {
      record('返回页面', status < 400 ? '后端已发送回答' : `后端已发送错误说明（HTTP ${status}）`);
      res.status(status).json({ ...body, trace });
    };

    record('收到请求', 'POST /api/ask');
    const question = req.body?.question;
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) {
      reply(400, { ok: false, error: { code: 'INVALID_QUESTION', message: '请输入 1 至 2000 字的问题。' } });
      return;
    }

    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.on('close', cancel);
    let modelBeganAt: number | undefined;
    try {
      const config = readConfig(env);
      trace.model = config.model;
      record('请求模型', `POST /chat/completions · ${config.model}`);
      modelBeganAt = performance.now();
      const result = await askModel(question.trim(), config, AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]));
      trace.modelDurationMs = Math.round(performance.now() - modelBeganAt);
      trace.modelHttpStatus = result.httpStatus;
      record('收到模型回复', `HTTP ${result.httpStatus} · 文本已完整返回`);
      reply(200, { ok: true, answer: result.answer });
    } catch (error) {
      const failure = error instanceof ModelError ? error : new ModelError('MODEL_NETWORK_ERROR', '本次请求未完成，请重试。');
      if (modelBeganAt !== undefined) trace.modelDurationMs = Math.round(performance.now() - modelBeganAt);
      if (failure.modelHttpStatus !== undefined) {
        trace.modelHttpStatus = failure.modelHttpStatus;
        record('收到模型回复', `HTTP ${failure.modelHttpStatus} · ${failure.code}`);
      }
      if (!res.destroyed) reply(failure.httpStatus, { ok: false, error: { code: failure.code, message: failure.message } });
    } finally {
      res.off('close', cancel);
    }
  });

  // JSON 解析失败也返回可读错误，避免 Express 的 HTML 错误页混进接口。
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status === 413 ? 413 : 400).json({
      ok: false,
      error: { code: 'INVALID_QUESTION', message: '请求格式不正确，或问题过长。' },
      trace: { requestId: randomUUID(), model: null, stages: [] },
    } satisfies AskResult);
  });
  return app;
}

async function start() {
  const app = createApp();
  if (process.argv.includes('--production')) {
    app.use(express.static(resolve('dist/client')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  const server = app.listen(4318, '127.0.0.1', () => console.log('请求观察室：http://127.0.0.1:4318'));
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE' ? '端口 4318 已被占用，请先停止另一个请求观察室。' : '服务启动失败。');
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch(() => { console.error('启动失败，请确认依赖已安装。'); process.exit(1); });
}
