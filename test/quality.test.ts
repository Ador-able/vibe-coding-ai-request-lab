import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { CASES, caseMessages, OUTPUT_RULE } from '../src/quality/materials.ts';
import { assessAnswer } from '../src/quality/assess.ts';
import { createApp } from '../src/server.ts';
import type { QualityCase, QualityCondition, QualityResponse } from '../src/quality/contract.ts';

const get = (condition: QualityCondition, sample: 'A' | 'B') => CASES.find((item) => item.condition === condition && item.sample === sample)!;
const sorted = (item: QualityCase) => [...item.documents].sort((a, b) => a.id.localeCompare(b.id));

test('长度仅增加无关资料，三种位置使用严格相同的文档集合与问题', () => {
  assert.equal(CASES.length, 12);
  for (const sample of ['A', 'B'] as const) {
    const short = get('short', sample), middle = get('middle', sample), first = get('first', sample), last = get('last', sample);
    assert.equal(short.documents.length, 16); assert.equal(middle.documents.length, 160);
    assert.deepEqual(sorted(first), sorted(middle)); assert.deepEqual(sorted(last), sorted(middle));
    assert.ok(short.documents.every((doc) => middle.documents.some((other) => other.id === doc.id && other.text === doc.text)));
    const positions = short.documents.map((doc) => middle.documents.findIndex((other) => other.id === doc.id));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    const key = middle.expected.source_ids[0];
    assert.equal(short.documents[7].id, key); assert.equal(middle.documents[79].id, key);
    assert.equal(first.documents[0].id, key); assert.equal(last.documents[159].id, key);
    assert.equal(first.question, middle.question); assert.equal(last.question, short.question);
    for (const item of CASES.filter((entry) => entry.sample === sample)) {
      assert.equal(new Set(item.documents.map((doc) => doc.id)).size, item.documents.length);
      assert.ok(item.documents.every((doc) => [...doc.text].length >= 80 && [...doc.text].length <= 140));
      assert.equal(caseMessages(item)[0].content, OUTPUT_RULE);
    }
  }
});

test('相似干扰只替换四项且保留目标；冲突仅替换一项、同等时效并保留一致日期', () => {
  for (const sample of ['A', 'B'] as const) {
    const middle = get('middle', sample), similar = get('similar', sample), conflict = get('conflict', sample);
    assert.equal(similar.documents.length, 160); assert.equal(conflict.documents.length, 160);
    const changed = (item: QualityCase) => item.documents.filter((doc, index) => doc.id !== middle.documents[index].id || doc.text !== middle.documents[index].text);
    assert.equal(changed(similar).length, 4); assert.equal(changed(conflict).length, 1);
    assert.deepEqual(similar.documents[79], middle.documents[79]); assert.deepEqual(conflict.documents[79], middle.documents[79]);
    const targetPrefix = `项目：${middle.project}；版本：${middle.version}；`;
    assert.equal(similar.documents.filter((doc) => doc.text.startsWith(targetPrefix)).length, 1);
    const conflicts = conflict.documents.filter((doc) => doc.text.startsWith(targetPrefix));
    assert.equal(conflicts.length, 2);
    assert.deepEqual(conflict.expected.source_ids, conflicts.map((doc) => doc.id));
    assert.deepEqual(conflicts.map((doc) => doc.text.replace(/负责人：[^；]+；/, '负责人：已隐藏；')), [conflicts[0].text.replace(/负责人：[^；]+；/, '负责人：已隐藏；'), conflicts[0].text.replace(/负责人：[^；]+；/, '负责人：已隐藏；')]);
    assert.equal(conflict.expected.status, 'conflict'); assert.equal(conflict.expected.owner, null);
    assert.equal(conflict.expected.freeze_date, middle.expected.freeze_date);
    assert.notEqual(conflicts[0].text, conflicts[1].text);
  }
});

test('缺字段、错误或不完整引用、截断不判通过；冲突允许空负责人且要求双方引用', () => {
  const expected = get('short', 'A').expected;
  const grade = (value: unknown) => assessAnswer(JSON.stringify(value), 'stop', expected);
  assert.equal(grade(expected).allCorrect, true);
  const { source_ids: _ids, ...missing } = expected;
  assert.equal(grade(missing).valid, false);
  assert.equal(grade({ ...expected, source_ids: ['A-D001'] }).allCorrect, false);
  assert.equal(grade({ ...expected, owner: '另一人' }).ownerCorrect, false);
  assert.equal(assessAnswer(JSON.stringify(expected), 'length', expected).allCorrect, false);
  const conflict = get('conflict', 'B').expected;
  assert.equal(assessAnswer(JSON.stringify(conflict), 'stop', conflict).allCorrect, true);
  assert.equal(assessAnswer(JSON.stringify({ ...conflict, source_ids: [conflict.source_ids[0]] }), 'stop', conflict).sourcesCorrect, false);
  assert.equal(assessAnswer(JSON.stringify({ ...conflict, source_ids: [conflict.source_ids[0], conflict.source_ids[0]] }), 'stop', conflict).sourcesCorrect, false);
  assert.equal(assessAnswer(JSON.stringify({ ...conflict, owner: '随意选择' }), 'stop', conflict).factsComplete, false);
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
    received = ''; for await (const chunk of req) received += chunk;
    count++; res.setHeader('Content-Type', 'application/json');
    if (count === 2) { res.writeHead(429); res.end('{"error":"private-api-key private-workspace"}'); return; }
    res.end(JSON.stringify({ model: 'test-boundary', choices: [{ message: { role: 'assistant', content: JSON.stringify(get('short', 'A').expected) }, finish_reason: 'stop' }], usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 } }));
  });
  const baseUrl = await listen(upstream);
  const backend = createServer(createApp({ MODEL: 'qwen-flash', API_BASE_URL: baseUrl, API_KEY: 'private-api-key' }, () => {}));
  const url = await listen(backend);
  const send = async () => {
    const response = await fetch(`${url}/api/quality/case`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: 'short-A', expected: '不可注入的期望', documents: ['不可注入的材料'] }) });
    return { status: response.status, data: await response.json() as QualityResponse };
  };
  try {
    const success = await send();
    assert.equal(success.status, 200); assert.equal(success.data.ok, true);
    assert.equal(success.data.result.request?.requestBody, received);
    const body = JSON.parse(received);
    assert.deepEqual(body.messages, caseMessages(get('short', 'A')));
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(Object.hasOwn(body, 'tools'), false); assert.equal(Object.hasOwn(body, 'tool_choice'), false);
    assert.equal(body.temperature, 0); assert.equal(body.max_tokens, 512); assert.equal(body.enable_thinking, false);
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
