import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { ModelError, readConfig } from '../model.ts';
import { isObject, sendRecordedRequest } from '../recorded-model.ts';
import { SYSTEM } from './scenario.ts';
import type { CollaborationResponse, CollaborationResult, Turn } from './contract.ts';

export function createCollaborationRouter(env: NodeJS.ProcessEnv) {
  const router = Router();
  router.use(express.json({ limit: '128kb' }));
  router.post('/turn', async (req, res) => {
    const { input, history } = req.body ?? {};
    // 页面持有本人的对话文本；后端只接收成对文本，角色和固定资料由后端构造。
    if (typeof input !== 'string' || !input.trim() || input.length > 6000 || !Array.isArray(history)
      || !history.every((turn: unknown) => isObject(turn) && typeof turn.input === 'string' && !!turn.input.trim()
        && typeof turn.answer === 'string' && !!turn.answer.trim())) {
      res.status(400).json({ error: '请输入1至6000字的任务或反馈，并保留完整的成功对话。' }); return;
    }
    const turns = history as Turn[];
    const result: CollaborationResult = { id: randomUUID(), round: turns.length + 1, input, answer: null, request: null };
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    try {
      const config = readConfig(env);
      if (config.model !== 'qwen-flash') throw new ModelError('CONFIG_INVALID', '本练习使用 qwen-flash，请核对 MODEL 配置后重启。', 503);
      const messages = [
        { role: 'system', content: SYSTEM },
        ...turns.flatMap((turn) => [{ role: 'user', content: turn.input }, { role: 'assistant', content: turn.answer }]),
        { role: 'user', content: input },
      ];
      result.request = {
        step: `第${result.round}轮共写`, startedAt: new Date().toISOString(),
        requestBody: JSON.stringify({ model: config.model, messages, stream: false, enable_thinking: false, temperature: 0, max_tokens: 1536 }),
      };
      const message = await sendRecordedRequest(config, result.request, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]));
      if (result.request.finishReason !== 'stop') throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '本轮回答没有完整结束；原始片段保留在记录中，不加入成功对话。');
      if (!isObject(message) || typeof message.content !== 'string' || !message.content.trim()) throw new ModelError('MODEL_RESPONSE_INVALID', '本轮没有收到可显示的文字回答，不加入成功对话。');
      result.answer = message.content;
      if (!res.destroyed) res.json({ ok: true, result } satisfies CollaborationResponse);
    } catch (error) {
      const failure = error instanceof ModelError ? error : new ModelError('MODEL_NETWORK_ERROR', '本轮未完成；任务或反馈保留，没有自动重试。');
      result.error = { code: failure.code, message: failure.message };
      if (!res.destroyed) res.status(failure.httpStatus).json({ ok: false, result } satisfies CollaborationResponse);
    } finally { res.off('close', cancel); }
  });
  router.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status === 413 ? 413 : 400).json({ error: error.status === 413
      ? '本次完整对话超过128KB，没有发送给模型。请下载记录，并在新页面明确整理下一次任务；系统不会自动删减历史。'
      : '请求格式不正确，本轮没有发送给模型。' });
  });
  return router;
}
