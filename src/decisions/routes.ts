import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { ModelError, readConfig } from '../model.ts';
import { isObject, sendRecordedRequest } from '../recorded-model.ts';
import { requestBody } from './scenario.ts';
import { parseOptions } from './parse.ts';
import type { DecisionRun, DecisionResponse } from './contract.ts';

export function createDecisionsRouter(env: NodeJS.ProcessEnv) {
  const router = Router();
  router.post('/generate', async (_req, res) => {
    const run: DecisionRun = { id: randomUUID(), request: null, options: null };
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    try {
      const config = readConfig(env);
      if (config.model !== 'qwen-flash') throw new ModelError('CONFIG_INVALID', '本练习使用qwen-flash，请核对MODEL配置后重启。', 503);
      run.request = { step: '生成两份候选文案', startedAt: new Date().toISOString(), requestBody: requestBody(config.model) };
      const message = await sendRecordedRequest(config, run.request, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]));
      if (!isObject(message) || typeof message.content !== 'string') throw new ModelError('MODEL_RESPONSE_INVALID', '没有收到可解析的文字消息；实际响应保留在记录中。');
      run.options = parseOptions(message.content, run.request.finishReason);
      if (!res.destroyed) res.json({ ok: true, run } satisfies DecisionResponse);
    } catch (error) {
      const failure = error instanceof ModelError ? error : new ModelError('MODEL_NETWORK_ERROR', '本次没有完成，已有记录保留，没有自动重试。');
      run.error = { code: failure.code, message: failure.message };
      if (!res.destroyed) res.status(failure.httpStatus).json({ ok: false, run } satisfies DecisionResponse);
    } finally { res.off('close', cancel); }
  });
  return router;
}
