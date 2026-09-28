import { Router } from 'express';
import { ModelError, readConfig } from '../model.ts';
import { isObject, sendRecordedRequest } from '../recorded-model.ts';
import { assessAnswer } from './assess.ts';
import { CASES, caseMessages } from './materials.ts';
import type { CaseResult, QualityResponse } from './contract.ts';

export function createQualityRouter(env: NodeJS.ProcessEnv) {
  const router = Router();
  // 只返回合成材料供预览；这里没有进行模型调用。
  router.get('/cases', (_req, res) => { res.json(CASES); });
  router.post('/case', async (req, res) => {
    const item = CASES.find((entry) => entry.id === req.body?.caseId);
    if (!item) { res.status(400).json({ error: { code: 'CASE_INVALID', message: '请选择本实验的固定样例。' } }); return; }
    const result: CaseResult = { caseId: item.id, startedAt: new Date().toISOString(), answer: null, expected: item.expected };
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    try {
      const config = readConfig(env);
      if (config.model !== 'qwen-flash') throw new ModelError('CONFIG_INVALID', '本实验固定使用 qwen-flash，请将 MODEL 配置为 qwen-flash 后重启服务。', 503);
      const requestBody = JSON.stringify({ model: config.model, messages: caseMessages(item), stream: false,
        enable_thinking: false, temperature: 0, max_tokens: 512, tool_choice: 'none', response_format: { type: 'json_object' } });
      result.request = { step: '固定样例提取', startedAt: new Date().toISOString(), requestBody };
      const message = await sendRecordedRequest(config, result.request, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]));
      if (!isObject(message) || typeof message.content !== 'string') {
        throw new ModelError('MODEL_RESPONSE_INVALID', '模型服务没有返回可识别的文本消息，已有响应保存在记录中。');
      }
      result.answer = message.content;
      result.assessment = assessAnswer(message.content, result.request.finishReason, item.expected);
      if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
        result.assessment = { parsed: null, valid: false, issue: '禁止工具调用时返回了工具指令，未执行。', statusCorrect: false, ownerCorrect: false, dateCorrect: false, sourcesCorrect: false, factsComplete: false, allCorrect: false };
      }
      if (!res.destroyed) res.json({ ok: true, result } satisfies QualityResponse);
    } catch (error) {
      const failure = error instanceof ModelError ? error : new ModelError('MODEL_NETWORK_ERROR', '本项请求未能完成，请检查本机服务与网络。');
      result.error = { code: failure.code, message: failure.message };
      if (!res.destroyed) res.status(failure.httpStatus).json({ ok: false, result } satisfies QualityResponse);
    } finally { res.off('close', cancel); }
  });
  return router;
}
