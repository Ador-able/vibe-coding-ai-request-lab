import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { CASES, caseMessages, OUTPUT_RULE } from '../src/quality/materials.ts';
import { assessAnswer } from '../src/quality/assess.ts';
import { createApp } from '../src/server.ts';
import type { QualityCase, QualityCondition, QualityResponse } from '../src/quality/contract.ts';

const get = (condition: QualityCondition) => CASES.find(item => item.condition === condition)!;
const sorted = (item: QualityCase) => [...item.documents].sort((a, b) => a.id.localeCompare(b.id));

test('长材料位置对照使用相同原文集合与问题，短材料只读相关原文', () => {
  const short = get('short'), middle = get('middle'), first = get('first'), last = get('last');
  assert.equal(short.documents.length, 1); assert.equal(middle.documents.length, 30);
  assert.deepEqual(sorted(first), sorted(middle)); assert.deepEqual(sorted(last), sorted(middle));
  assert.deepEqual(short.documents[0], middle.documents[15]);
  assert.equal(first.documents[0].id, 'C28'); assert.equal(last.documents[29].id, 'C28');
  assert.equal(first.question, middle.question); assert.equal(last.question, short.question);
});

test('缺字段、错误和重复引用、截断均不判通过', () => {
  const expected = get('short').expected;
  const grade = (value: unknown) => assessAnswer(JSON.stringify(value), 'stop', expected);
  assert.equal(grade(expected).allCorrect, true);
  const { source_ids: _ids, ...missing } = expected;
  assert.equal(grade(missing).valid, false);
  assert.equal(grade({ ...expected, source_ids: ['C02'] }).allCorrect, false);
  assert.equal(grade({ ...expected, source_ids: ['C28','C28'] }).sourcesCorrect, false);
  assert.equal(grade({ ...expected, actual_level: 5 }).levelCorrect, false);
  assert.equal(grade({ ...expected, mistaken_drug: '五毒水' }).drugCorrect, false);
  assert.equal(grade({ ...expected, mistaken_drug: '普通迷药神仙倒' }).drugCorrect, true);
  assert.equal(assessAnswer(JSON.stringify(expected), 'length', expected).allCorrect, false);
});

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('HTTP 边界收到的原串就是检查器请求，失败保留记录且不产生评分', async () => {
  // 此处仅用测试桩验证协议，不把预设 JSON 当作真实模型效果。
  let received = ''; let count = 0;
  const upstream = createServer(async (req, res) => {
    req.setEncoding('utf8'); received = ''; for await (const chunk of req) received += chunk;
    count++; res.setHeader('Content-Type', 'application/json');
    if (count === 2) { res.writeHead(429); res.end('{"error":"private-api-key private-workspace"}'); return; }
    res.end(JSON.stringify({ model: 'test-boundary', choices: [{ message: { role: 'assistant', content: JSON.stringify(get('short').expected) }, finish_reason: 'stop' }], usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 } }));
  });
  const baseUrl = await listen(upstream);
  const backend = createServer(createApp({ MODEL: 'qwen-flash', API_BASE_URL: baseUrl, API_KEY: 'private-api-key' }, () => {}));
  const url = await listen(backend);
  const send = async () => {
    const response = await fetch(`${url}/api/quality/case`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: 'short', expected: '不可注入的期望', documents: ['不可注入的材料'] }) });
    return { status: response.status, data: await response.json() as QualityResponse };
  };
  try {
    const success = await send();
    assert.equal(success.status, 200); assert.equal(success.data.ok, true);
    assert.equal(success.data.result.request?.requestBody, received);
    const body = JSON.parse(received);
    assert.deepEqual(body.messages, caseMessages(get('short')));
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(Object.hasOwn(body, 'tools'), false); assert.equal(Object.hasOwn(body, 'tool_choice'), false);
    assert.equal(body.temperature, 0); assert.equal(body.max_tokens, 32768); assert(!('enable_thinking' in body));
    assert.equal(success.data.result.assessment?.allCorrect, true);
    const failed = await send();
    assert.equal(failed.status, 502); assert.equal(failed.data.ok, false);
    assert.equal(failed.data.result.request?.requestBody, received);
    assert.equal(failed.data.result.request?.httpStatus, 429);
    assert.equal(failed.data.result.assessment, undefined);
    assert.equal(JSON.stringify(failed.data).includes('private-api-key'), false);
    assert.equal(JSON.stringify(failed.data).includes('private-workspace'), false);
    assert.equal(count, 2);
  } finally { await close(backend); await close(upstream); }
});
