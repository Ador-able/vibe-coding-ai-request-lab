import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFeedbackRouter } from '../src/feedback/routes.ts';
import { createRuleStore } from '../src/feedback/rule-store.ts';
import { CATALOG, ORDERS, SUGGESTED_RULE, buildRequestBody } from '../src/feedback/scenario.ts';
import { parseAnswer } from '../src/feedback/parse.ts';
import type { FeedbackResponse, RuleResponse } from '../src/feedback/contract.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('每个订单都独立使用同一目录，附带规则是唯一对照变化，不按客户替换输入', () => {
  const rule = { text: SUGGESTED_RULE, enabled: true, confirmedAt: '2026-09-29T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z' };
  for (const order of ORDERS) {
    const plain = JSON.parse(buildRequestBody('qwen-flash', order, null));
    const saved = JSON.parse(buildRequestBody('qwen-flash', order, rule));
    assert.equal(plain.messages.length, 2); assert.equal(saved.messages.length, 2);
    assert.equal(plain.messages[1].content, `产品目录：\n${JSON.stringify(CATALOG)}\n\n订单：\n${JSON.stringify(order)}`);
    assert.equal(saved.messages[1].content, `${plain.messages[1].content}\n\n经人确认的业务规则：\n${SUGGESTED_RULE}`);
    saved.messages[1].content = plain.messages[1].content; assert.deepEqual(saved, plain);
  }
});

test('只解析模型字段，不修正错误编号；缺字段、无效JSON或截断不被当成有效回答', () => {
  assert.deepEqual(parseAnswer('{"sku":"BL99","reason":"测试桩错误编号"}', 'stop'), { sku: 'BL99', reason: '测试桩错误编号' });
  assert.deepEqual(parseAnswer('{"sku":null,"reason":"需要确认具体产品"}', 'stop'), { sku: null, reason: '需要确认具体产品' });
  for (const invalid of ['{"sku":"BL01"}', '{"sku":0,"reason":"数字类型错误"}', '{"sku":null,"reason":""}', '不是JSON']) {
    assert.throws(() => parseAnswer(invalid, 'stop'), { code: 'MODEL_RESPONSE_INVALID' });
  }
  assert.throws(() => parseAnswer('{"sku":"BL01","reason":"测试"}', 'length'), { code: 'MODEL_RESPONSE_INCOMPLETE' });
});

test('确认后持久保存，独立读取仍有效；在途快照不随编辑改变，停用不再请求模型', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'feedback-lab-'));
  const path = join(folder, 'rule.json');
  const received: string[] = [];
  let release!: () => void;
  let notify!: () => void;
  const entered = new Promise<void>((resolve) => { notify = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  // 本地HTTP桩故意给出固定编号，只验证传输和快照，不提供课程实测答案。
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part; received.push(body);
    if (received.length === 2) { notify(); await gate; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'qwen-flash-test', choices: [{ message: { role: 'assistant', content: '{"sku":"BL01","reason":"HTTP测试桩回答"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  });
  const base = await listen(upstream);
  const app = express(); app.use(express.json()); app.use('/api/feedback', createFeedbackRouter({ API_BASE_URL: base, API_KEY: 'test-private-key', MODEL: 'qwen-flash' }, path));
  const backend = createServer(app); const url = await listen(backend);
  const request = (endpoint: string, method: string, body: unknown) => fetch(`${url}/api/feedback${endpoint}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const rejected = await request('/rule', 'PUT', { text: SUGGESTED_RULE, confirmed: false }); assert.equal(rejected.status, 400);
    assert.equal(await createRuleStore(path).load(), null);
    const save = await request('/rule', 'PUT', { text: SUGGESTED_RULE, confirmed: true });
    const saved = await save.json() as RuleResponse; assert.equal(save.status, 200); assert(saved.rule?.enabled);
    assert.deepEqual(await createRuleStore(path).load(), saved.rule);

    const plain = await request('/run', 'POST', { orderId: 'A', ruleMode: 'none' }); const plainData = await plain.json() as FeedbackResponse;
    assert.equal(plainData.run.ruleSnapshot, null); assert.equal(plainData.run.request?.requestBody, received[0]);
    assert(!received[0].includes(SUGGESTED_RULE));
    const inFlight = request('/run', 'POST', { orderId: 'A', ruleMode: 'saved' }); await entered;
    const newText = '青禾门店的“常规蓝”仍需联系客户确认具体产品。';
    await request('/rule', 'PUT', { text: newText, confirmed: true });
    release();
    const response = await inFlight; const data = await response.json() as FeedbackResponse;
    assert.equal(data.run.answer?.sku, 'BL01'); assert.equal(data.run.rawAnswer, '{"sku":"BL01","reason":"HTTP测试桩回答"}');
    assert.deepEqual(data.run.ruleSnapshot, saved.rule); assert.equal(data.run.request?.requestBody, received[1]);
    assert(received[1].includes(SUGGESTED_RULE)); assert(!received[1].includes(newText));
    assert.equal((await createRuleStore(path).load())?.text, newText);
    const disabled = await request('/rule/disable', 'POST', {}); assert.equal(disabled.status, 200);
    assert.equal((await createRuleStore(path).load())?.enabled, false);
    const blocked = await request('/run', 'POST', { orderId: 'B', ruleMode: 'saved' }); const blockedData = await blocked.json() as FeedbackResponse;
    assert.equal(blocked.status, 409); assert.equal(blockedData.run.request, null); assert.equal(received.length, 2);
    assert.equal(data.run.ruleSnapshot?.enabled, true);
    const reenabled = await request('/rule', 'PUT', { text: SUGGESTED_RULE, confirmed: true }); assert.equal(reenabled.status, 200);
    assert.equal((await createRuleStore(path).load())?.enabled, true);
    assert(!JSON.stringify([data, plainData, blockedData]).includes('test-private-key')); assert(!JSON.stringify(data).includes(base));
  } finally { release(); await close(backend); await close(upstream); await rm(folder, { recursive: true, force: true }); }
});
