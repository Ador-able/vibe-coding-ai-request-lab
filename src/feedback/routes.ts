import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ModelError, readConfig } from '../model.ts';
import { isObject, sendRecordedRequest } from '../recorded-model.ts';
import { createRuleStore } from './rule-store.ts';
import { buildRequestBody, ORDERS } from './scenario.ts';
import { parseAnswer } from './parse.ts';
import type { FeedbackRun, FeedbackResponse, RuleResponse } from './contract.ts';

export function createFeedbackRouter(env: NodeJS.ProcessEnv, storePath = resolve('.local-data/feedback-rule.json')) {
  const router = Router();
  const store = createRuleStore(storePath);
  const storageError = '本地规则无法读取或保存，请检查 .local-data/feedback-rule.json。没有调用模型。';
  router.get('/rule', async (_req, res) => {
    try { res.json({ rule: await store.load() } satisfies RuleResponse); }
    catch { res.status(503).json({ rule: null, error: storageError } satisfies RuleResponse); }
  });
  router.put('/rule', async (req, res) => {
    const { text, confirmed } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim() || text.length > 2000 || confirmed !== true) {
      res.status(400).json({ rule: null, error: '请输入1至2000字的规则，并确认已核对它的适用范围。' } satisfies RuleResponse); return;
    }
    try { res.json({ rule: await store.save(text.trim()) } satisfies RuleResponse); }
    catch { res.status(503).json({ rule: null, error: storageError } satisfies RuleResponse); }
  });
  router.post('/rule/disable', async (_req, res) => {
    try { res.json({ rule: await store.disable() } satisfies RuleResponse); }
    catch { res.status(503).json({ rule: null, error: storageError } satisfies RuleResponse); }
  });
  router.post('/run', async (req, res) => {
    const order = ORDERS.find((item) => item.id === req.body?.orderId);
    const ruleMode = req.body?.ruleMode;
    if (!order || !['none', 'saved'].includes(ruleMode)) {
      res.status(400).json({ error: '请选择本实验的订单和规则方式。' }); return;
    }
    const run: FeedbackRun = { id: randomUUID(), order, ruleMode, ruleSnapshot: null, request: null, rawAnswer: null, answer: null };
    if (ruleMode === 'saved') {
      try { run.ruleSnapshot = await store.load(); }
      catch {
        run.error = { code: 'RULE_STORAGE_ERROR', message: storageError };
        res.status(503).json({ ok: false, run } satisfies FeedbackResponse); return;
      }
      if (!run.ruleSnapshot?.enabled) {
        run.error = { code: 'RULE_UNAVAILABLE', message: '没有启用的已确认规则，本次未请求模型。请确认保存规则，或选择不带规则。' };
        res.status(409).json({ ok: false, run } satisfies FeedbackResponse); return;
      }
    }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    try {
      const config = readConfig(env);
      if (config.model !== 'qwen-flash') throw new ModelError('CONFIG_INVALID', '本练习使用 qwen-flash，请核对 MODEL 配置后重启。', 503);
      run.request = { step: `订单${order.id} · ${ruleMode === 'saved' ? '附带已保存规则' : '不带规则'}`,
        startedAt: new Date().toISOString(), requestBody: buildRequestBody(config.model, order, run.ruleSnapshot) };
      const message = await sendRecordedRequest(config, run.request, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]));
      if (!isObject(message) || typeof message.content !== 'string') throw new ModelError('MODEL_RESPONSE_INVALID', '没有收到可显示的回答，实际响应已保留。');
      run.rawAnswer = message.content;
      run.answer = parseAnswer(run.rawAnswer, run.request.finishReason);
      if (!res.destroyed) res.json({ ok: true, run } satisfies FeedbackResponse);
    } catch (error) {
      const failure = error instanceof ModelError ? error : new ModelError('MODEL_NETWORK_ERROR', '本次请求未完成，没有自动重试。');
      run.error = { code: failure.code, message: failure.message };
      if (!res.destroyed) res.status(failure.httpStatus).json({ ok: false, run } satisfies FeedbackResponse);
    } finally { res.off('close', cancel); }
  });
  return router;
}
