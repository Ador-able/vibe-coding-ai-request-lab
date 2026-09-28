import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import express from 'express';
import { runFlow, noteMessages, parseSelectedIds } from '../src/memory/flows.ts';
import { answerMessages, CATALOG, SOURCE_MAP, SOURCES, sourceText, TEACHING_NOTE } from '../src/memory/materials.ts';
import { costOf, type Flow, type FlowResult, type SavedNote } from '../src/memory/contract.ts';
import { createMemoryRouter } from '../src/memory/routes.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
const record = (flow: Flow): FlowResult => ({ id: 'test-record', flow, startedAt: new Date().toISOString(), requests: [], answer: null });

test('选择编号必须真实且唯一；目录只提供元数据而不夹带原文', () => {
  assert.deepEqual(parseSelectedIds('{"source_ids":["C03","C04"]}'), ['C03', 'C04']);
  for (const input of ['{"source_ids":[]}', '{"source_ids":["C99"]}', '{"source_ids":["C03","C03"]}', '{"source_ids":["C03"],"extra":true}']) assert.throws(() => parseSelectedIds(input));
  assert.ok(CATALOG.every((metadata) => !Object.hasOwn(metadata, 'text')));
  assert.ok(SOURCES.every((source) => !JSON.stringify(CATALOG).includes(source.text)));
});

test('按需流程只读选中原文，摘要回答只带实际摘要；完整请求串与检查器一致', async () => {
  // 本地 HTTP 测试桩检查输入边界，不代表实际模型选择和摘要能力。
  const received: string[] = [];
  const selected = ['C02', 'C03', 'C04', 'C05'];
  const summaryText = '测试桩摘要：申请尚待书面确认[C04]，清场条件见[C05]。';
  const outputs = ['全文测试回答', JSON.stringify({ source_ids: selected }), '选后测试回答', summaryText, '摘要后测试回答'];
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push(body); const index = received.length - 1;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'test-model', choices: [{ message: { role: 'assistant', content: outputs[index] }, finish_reason: 'stop' }], usage: { prompt_tokens: 100 + index, completion_tokens: 10 + index } }));
  });
  const baseUrl = await listen(upstream);
  const config = { baseUrl, model: 'test-model', apiKey: 'test-only-key' };
  try {
    const records = [record('full'), record('retrieve'), record('summary')];
    for (const result of records) await runFlow(config, result, AbortSignal.timeout(5000));
    assert.equal(received.length, 5);
    assert.deepEqual(records.flatMap((result) => result.requests.map((request) => request.requestBody)), received);
    assert.deepEqual(JSON.parse(received[0]).messages, answerMessages(sourceText(SOURCES.map((source) => source.id))));
    assert.deepEqual(records[1].selectedIds, selected);
    assert.deepEqual(JSON.parse(received[2]).messages, answerMessages(sourceText(selected)));
    assert.ok(!received[2].includes(SOURCE_MAP.get('C01')!.text));
    assert.equal(records[2].summary, summaryText);
    assert.deepEqual(JSON.parse(received[4]).messages, answerMessages(`以下是模型整理的任务摘要，本轮未附原文：\n${summaryText}`));
    assert.ok(!received[4].includes(SOURCE_MAP.get('C02')!.text));
    assert.equal(records[2].answer, '摘要后测试回答');
    assert.deepEqual(costOf(records[2]), { finalInput: 104, totalInput: 207, totalOutput: 27, total: 234 });
    assert.equal(JSON.stringify(records).includes('test-only-key'), false); assert.equal(JSON.stringify(records).includes(baseUrl), false);
  } finally { await close(upstream); }
});

test('便笺需人确认，重启路由后从文件读取；来源可回查，新输入没有旧聊天', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'memory-lab-test-'));
  const notePath = join(dir, 'task-note.json');
  const makeServer = () => { const app = express(); app.use(express.json()); app.use('/api/memory', createMemoryRouter({}, notePath)); return createServer(app); };
  let backend = makeServer(); let url = await listen(backend);
  try {
    const notConfirmed = await fetch(`${url}/api/memory/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"confirmed":false}' });
    assert.equal(notConfirmed.status, 400);
    assert.equal((await (await fetch(`${url}/api/memory/note`)).json()).saved, null);
    const response = await fetch(`${url}/api/memory/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"confirmed":true,"note":"不能由客户端替换"}' });
    const { saved }: { saved: SavedNote } = await response.json();
    assert.equal(saved.origin, 'reader-confirmed-teaching-note'); assert.deepEqual(saved.note, TEACHING_NOTE);
    await close(backend); backend = makeServer(); url = await listen(backend);
    assert.deepEqual((await (await fetch(`${url}/api/memory/note`)).json()).saved, saved);
    const source = await (await fetch(`${url}/api/memory/sources/C03`)).json();
    assert.deepEqual(source, SOURCE_MAP.get('C03'));
    assert.equal((await fetch(`${url}/api/memory/sources/C99`)).status, 404);
    const messages = noteMessages(saved); assert.deepEqual(messages.map((message) => message.role), ['system', 'user']);
    for (const reference of saved.note.sources) {
      assert.equal(reference.date, SOURCE_MAP.get(reference.id)!.date);
      assert.ok(messages[1].content.includes(SOURCE_MAP.get(reference.id)!.text));
    }
    assert.ok(!messages[1].content.includes(SOURCE_MAP.get('C10')!.text));
  } finally {
    await close(backend);
    assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('memory-lab-test-'));
    await rm(dir, { recursive: true });
  }
});

test('后续调用失败保留前一步和真实部分用量，不补零冒称总成本', async () => {
  let count = 0;
  const upstream = createServer((_req, res) => {
    count++; res.setHeader('Content-Type', 'application/json');
    if (count === 1) res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '测试桩摘要' }, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 20 } }));
    else { res.writeHead(429); res.end('{"error":"test-secret-service-path"}'); }
  });
  const baseUrl = await listen(upstream); const result = record('summary');
  try {
    await assert.rejects(runFlow({ baseUrl, model: 'test', apiKey: 'test-only-key' }, result, AbortSignal.timeout(5000)));
    assert.equal(count, 2); assert.equal(result.summary, '测试桩摘要'); assert.equal(result.answer, null);
    assert.equal(result.requests[1].httpStatus, 429);
    assert.deepEqual(costOf(result), { finalInput: null, totalInput: null, totalOutput: null, total: null });
    assert.equal(JSON.stringify(result).includes('test-secret-service-path'), false);
  } finally { await close(upstream); }
});
