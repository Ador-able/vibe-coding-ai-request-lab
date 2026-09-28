import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { ModelError, readConfig } from '../model.ts';
import { CONDITIONS, MANUAL, QUESTION, TARGET, requestBody, type Condition } from './materials.ts';
import { streamModel } from './model.ts';
import type { ClientEvent, StreamRecord } from './contract.ts';

export function createLatencyRouter(env: NodeJS.ProcessEnv) {
  const router = Router();
  router.get('/materials', (_req, res) => { res.json({ question: QUESTION, short: TARGET, long: MANUAL }); });
  router.post('/run', async (req, res) => {
    const condition = req.body?.condition;
    if (typeof condition !== 'string' || !Object.hasOwn(CONDITIONS, condition)) { res.status(400).json({ error: '请选择固定对照条件。' }); return; }
    let config;
    try {
      config = readConfig(env);
      if (config.model !== 'qwen-flash') throw new ModelError('CONFIG_INVALID', '本实验使用 qwen-flash，请核对 MODEL 配置后重启。', 503);
    } catch (error) {
      const failure = error as ModelError;
      res.status(failure.httpStatus).json({ error: failure.message }); return;
    }
    const record: StreamRecord = {
      id: randomUUID(), condition: condition as Condition, startedAt: new Date().toISOString(),
      requestBody: requestBody(condition as Condition, config.model),
      responseModel: null, httpStatus: null, events: [], answer: '', firstContentMs: null,
      streamEndMs: null, endedBy: null, finishReason: null, usage: null,
    };
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (event: ClientEvent) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
    send({ type: 'start', record });
    try {
      await streamModel(config, record, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]), (text, elapsedMs) => send({ type: 'delta', text, elapsedMs }));
    } catch { /* 已由传输层保存不含敏感原文的失败与实际片段。 */ }
    finally {
      if (!res.destroyed) { send({ type: 'complete', record }); res.end(); }
      res.off('close', cancel);
    }
  });
  return router;
}
