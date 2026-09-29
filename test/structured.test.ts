import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createStructuredApp } from '../src/structured/server.ts';
import { JSON_SCHEMA } from '../src/structured/schema.ts';
import { inspectResponse } from '../src/structured/inspect.ts';
import { COUNTEREXAMPLE, COUNTEREXAMPLE_CHECK } from '../src/structured/counterexample.ts';
import { MATERIALS } from '../src/structured/materials.ts';
import type { Mode, StructuredResponse } from '../src/structured/contract.ts';

const message = (value: unknown) => ({ content: JSON.stringify(value) });
const unknownTask = { task: '整理物料清单', owner: null, dueText: null, evidence: '整理物料清单' };

test('必填与nullable分开检查，额外字段不被静默丢弃，空列表合法', () => {
  const valid = inspectResponse(message({ items: [unknownTask] }), 'stop', '整理物料清单');
  assert.deepEqual(valid.data, { items: [unknownTask] });
  assert.deepEqual(inspectResponse(message({ items: [] }), 'stop', '本次没有待办').data, { items: [] });
  for (const invalid of [{}, { items: [], extra: true }, { items: [{ ...unknownTask, extra: true }] }, { items: [{ task: '整理物料清单', evidence: '整理物料清单' }] }, { items: [{ ...unknownTask, owner: 12 }] }]) {
    const checked = inspectResponse(message(invalid), 'stop', '整理物料清单');
    assert.equal(checked.checks[1].status, 'pass'); assert.equal(checked.checks[2].status, 'fail'); assert.equal(checked.data, null);
  }
  const schema = JSON_SCHEMA as unknown as { additionalProperties: boolean; required: string[]; properties: { items: { items: { additionalProperties: boolean; required: string[]; properties: { owner: { type: string[] } } } } } };
  assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.items.items.additionalProperties, false);
  assert.deepEqual(schema.properties.items.items.required, ['task', 'owner', 'dueText', 'evidence']);
  assert.deepEqual(schema.properties.items.items.properties.owner.type, ['string', 'null']);
});

test('拒绝、截断和无正文先停止，JSON解析失败不替换为合法空列表', () => {
  for (const [response, finish] of [[message({ items: [] }), 'length'], [{ content: '{"items":[]}', refusal: '测试拒绝' }, 'stop'], [message({ items: [] }), 'content_filter'], [{ content: '' }, 'stop'], [{ content: null }, 'stop'], [message({ items: [] }), null]] as const) {
    const checked = inspectResponse(response, finish, '本次没有待办');
    assert.equal(checked.checks[0].status, 'fail'); assert.equal(checked.checks[1].status, 'skip'); assert.equal(checked.data, null);
  }
  const malformed = inspectResponse({ content: '```json\n{"items":[]}\n```' }, 'stop', '本次没有待办');
  assert.equal(malformed.checks[0].status, 'pass'); assert.equal(malformed.checks[1].status, 'fail'); assert.equal(malformed.data, null);
});

test('原句存在不等于负责人正确，引用未找到时仍保留原始提取内容', () => {
  assert.equal(COUNTEREXAMPLE_CHECK.checks[2].status, 'pass'); assert.equal(COUNTEREXAMPLE_CHECK.checks[3].status, 'pass');
  assert.equal(COUNTEREXAMPLE_CHECK.data?.items[0].owner, '周宇'); assert(COUNTEREXAMPLE.material.includes('陈岚负责'));
  const missing = inspectResponse(message({ items: [unknownTask] }), 'stop', '本次没有待办');
  assert.equal(missing.checks[3].status, 'fail'); assert.deepEqual(missing.data, { items: [unknownTask] }); assert.equal(missing.evidence?.[0].start, null);
});

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('三种方式实际发送体与检查器一致，只改变输出格式参数；HTTP失败保留记录且不泄露凭据', async () => {
  const received: string[] = [];
  // 本地HTTP桩只验证协议，不作为真实模型效果记录。
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part; received.push(body);
    res.setHeader('Content-Type', 'application/json');
    if (received.length === 4) { res.statusCode = 401; res.end('{"private":"test-secret"}'); return; }
    res.end(JSON.stringify({ model: 'structured-test', choices: [{ message: message({ items: [] }), finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4 } }));
  });
  const base = await listen(upstream);
  const backend = createServer(createStructuredApp({ API_BASE_URL: base, API_KEY: 'test-secret', MODEL: 'do-not-use', STRUCTURED_MODEL: 'structured-test' }));
  const url = await listen(backend);
  const request = (mode: string) => fetch(`${url}/api/structured/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ material: MATERIALS[0].text, mode }) });
  try {
    assert.equal((await request('invalid')).status, 400); assert.equal(received.length, 0);
    const bodies: Record<string, unknown>[] = [];
    for (const mode of ['prompt', 'object', 'strict'] satisfies Mode[]) {
      const response = await request(mode); const data = await response.json() as StructuredResponse;
      assert.equal(response.status, 200); assert.equal(data.run.request?.requestBody, received.at(-1));
      assert.equal(data.run.rawAnswer, '{"items":[]}'); assert.deepEqual(data.run.inspection?.data, { items: [] });
      assert(!JSON.stringify(data).includes('test-secret')); assert(!JSON.stringify(data).includes(base));
      bodies.push(JSON.parse(received.at(-1)!));
    }
    assert.equal(bodies[0].model, 'structured-test'); assert(!('response_format' in bodies[0]));
    assert.deepEqual(bodies[1].response_format, { type: 'json_object' });
    assert.deepEqual(bodies[2].response_format, { type: 'json_schema', json_schema: { name: 'meeting_tasks', strict: true, schema: JSON_SCHEMA } });
    for (const body of bodies.slice(1)) { delete body.response_format; assert.deepEqual(body, bodies[0]); }
    const failed = await request('prompt'); const data = await failed.json() as StructuredResponse;
    assert.equal(failed.status, 502); assert.equal(data.run.request?.httpStatus, 401); assert.equal(data.run.inspection, null); assert.equal(data.run.rawAnswer, null);
    assert(!JSON.stringify(data).includes('test-secret')); assert.equal(received.length, 4);
  } finally { await close(backend); await close(upstream); }
});

test('经Core调用后仍保留拒绝与不合格原文，应用检查不被SDK替换为成功对象', async () => {
  const outputs = [
    { content: '{not-json' },
    { content: '{"items":[{"task":"准备物料"}]}' },
    { content: null, refusal: '测试拒绝' },
  ];
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _part of req) {}
    const responseMessage = outputs[calls++];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: responseMessage, finish_reason: 'stop' }] }));
  });
  const base = await listen(upstream);
  const backend = createServer(createStructuredApp({ API_BASE_URL: base, API_KEY: 'test-secret', STRUCTURED_MODEL: 'structured-test' })); const url = await listen(backend);
  try {
    for (const [i, original] of outputs.entries()) {
      const response = await fetch(`${url}/api/structured/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ material: '准备物料', mode: 'strict' }) });
      const data = await response.json() as StructuredResponse;
      assert.deepEqual(data.run.request?.responseMessage, original); assert.equal(data.run.request?.usage, null);
      assert.equal(data.run.rawAnswer, original.content); assert.equal(data.run.inspection?.data, null);
      assert.equal(data.run.inspection?.checks[i === 0 ? 1 : i === 1 ? 2 : 0].status, 'fail');
    }
    assert.equal(calls, 3);
  } finally { await close(backend); await close(upstream); }
});
