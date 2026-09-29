import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { DefaultChatTransport, readUIMessageStream } from 'ai';
import { createStreamingApp } from '../src/streaming/server.ts';
import type { AssistantMessage, Chunk, RunRecord } from '../src/streaming/contract.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address();
  assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
const data = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const delta = (text: string, finish: string | null = null) => data({ model: 'stream-test', choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] });
async function send(res: ServerResponse, text: string, finish = 'stop') {
  res.setHeader('Content-Type', 'text/event-stream');
  const bytes = Buffer.from(delta('') + delta(text) + delta('', finish) + data({ model: 'stream-test', choices: [], usage: { prompt_tokens: 30, completion_tokens: 12 } }) + 'data: [DONE]\r\n\r\n');
  // 强制跨字节/事件分片；这是本地HTTP测试桩，不是模型输出证据。
  for (let i = 0; i < bytes.length; i += 7) { res.write(bytes.subarray(i, i + 7)); await new Promise<void>((resolve) => setImmediate(resolve)); }
  res.end();
}
async function client(url: string, id: string, onEvent?: (event: Chunk) => Promise<void>) {
  const transport = new DefaultChatTransport<AssistantMessage>({ api: `${url}/api/streaming/run`, prepareSendMessagesRequest: () => ({ body: { runId: id, material: '明确计划仍有开放时间和值班安排待确认。' } }) });
  const events: Chunk[] = []; let message: AssistantMessage | null = null;
  const stream = await transport.sendMessages({ trigger: 'submit-message', chatId: id, messageId: undefined, messages: [], abortSignal: undefined });
  const recorded = stream.pipeThrough(new TransformStream({ async transform(event, controller) { events.push(structuredClone(event) as Chunk); await onEvent?.(event as Chunk); controller.enqueue(event); } }));
  for await (const snapshot of readUIMessageStream<AssistantMessage>({ stream: recorded, onError: () => {} })) message = snapshot;
  const record = await (await fetch(`${url}/api/streaming/${id}/record`)).json() as RunRecord;
  return { events, message: message!, record };
}

test('两个真实HTTP子流合成一条消息，同ID进度更新；空增量不变正文，第一阶段不结束整条任务', async () => {
  const bodies: string[] = [];
  const upstream = createServer(async (req, res) => { let body = ''; for await (const part of req) body += part; bodies.push(body); await send(res, bodies.length === 1 ? '计划已明确，开放时间和值班仍待确认。' : '1. 开放时段何时确定？\n2. 谁来安排值班？'); });
  const base = await listen(upstream); const backend = createServer(createStreamingApp({ API_BASE_URL: base, API_KEY: 'test-private-key', MODEL: 'stream-test' })); const url = await listen(backend);
  try {
    const result = await client(url, 'completed-run');
    assert.equal(result.record.state, 'completed'); assert.equal(bodies.length, 2);
    assert.equal(result.events.filter((event) => event.type === 'start').length, 1); assert.equal(result.events.filter((event) => event.type === 'finish').length, 1);
    assert.equal(result.events.filter((event) => event.type === 'finish-step').length, 2); assert.equal(result.events.at(-1)?.type, 'finish');
    assert.equal(result.message.id, 'completed-run'); assert.equal(result.message.parts.filter((part) => part.type === 'data-progress').length, 1);
    const progressHistory = (events: Chunk[]) => events.filter((event) => event.type === 'data-progress').map((event) => event.data.stage);
    assert.deepEqual(progressHistory(result.events), ['summary', 'questions', 'completed']);
    assert.deepEqual(progressHistory(result.record.uiEvents.map((item) => item.event)), ['summary', 'questions', 'completed']);
    assert.deepEqual(result.message.parts.filter((part) => part.type === 'data-progress').map((part) => part.data.stage), ['completed']);
    assert.deepEqual(result.record.finalMessage?.parts.filter((part) => part.type === 'data-progress').map((part) => part.data.stage), ['completed']);
    assert.deepEqual(result.message.parts.filter((part) => part.type === 'text').map((part) => part.text), result.record.stages.map((stage) => stage.answer));
    assert.equal(result.message.metadata?.state, 'completed'); assert.equal(result.message.metadata?.stages.length, 2);
    assert(result.events.filter((event) => event.type === 'text-delta').every((event) => event.delta.length > 0));
    assert.deepEqual(result.events, result.record.uiEvents.map((item) => item.event));
    result.record.stages.forEach((stage, i) => {
      assert.equal(stage.requestBody, bodies[i]); assert.equal(stage.finishReason, 'stop'); assert.equal(stage.sdkFinishReason, 'stop');
      assert.deepEqual(stage.usage, { prompt_tokens: 30, completion_tokens: 12 });
      assert.equal(stage.providerChunks.length, 4);
      const request = JSON.parse(stage.requestBody);
      assert.equal(request.enable_thinking, false); assert.equal(request.temperature, 0);
      assert.deepEqual(request.stream_options, { include_usage: true });
      assert.equal(request.max_tokens, i === 0 ? 256 : 384);
    });
    assert(JSON.parse(bodies[1]).messages[1].content.includes(result.record.stages[0].answer));
    assert(!JSON.stringify(result).includes('test-private-key')); assert(!JSON.stringify(result).includes(base));
  } finally { await close(backend); await close(upstream); }
});

test('HTTP错误不重试，截断、问题数量不符和流中异常不产生任务完成事件', async () => {
  for (const scenario of ['http', 'length', 'questions', 'broken'] as const) {
    let calls = 0;
    const upstream = createServer(async (req, res) => {
      for await (const _part of req) { /* 读取测试请求。 */ } calls++;
      if (scenario === 'http') { res.statusCode = 429; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: { message: 'test-secret-provider-error' } })); }
      else if (scenario === 'broken') { res.setHeader('Content-Type', 'text/event-stream'); res.write(delta('已收到部分摘要')); res.end('data: {"error":{"message":"test-secret-provider-error"}}\r\n\r\n'); }
      else await send(res, calls === 1 ? '计划尚待确认。' : '1. 只有一个问题？', scenario === 'length' ? 'length' : 'stop');
    });
    const base = await listen(upstream); const backend = createServer(createStreamingApp({ API_BASE_URL: base, API_KEY: 'test-key', MODEL: 'stream-test' })); const url = await listen(backend);
    try {
      const result = await client(url, `${scenario}-run`);
      assert.equal(result.record.state, 'failed');
      assert.equal(result.message.parts.some((part) => part.type === 'text' && part.text.length > 0), scenario !== 'http');
      assert(!result.events.some((event) => event.type === 'finish')); assert(result.events.some((event) => event.type === 'error'));
      assert.equal(calls, scenario === 'questions' ? 2 : 1); assert.equal(result.message.metadata?.state, 'failed');
      assert(!JSON.stringify(result).includes('test-secret-provider-error'));
    } finally { await close(backend); await close(upstream); }
  }
});

test('按请求ID停止会中止上游，旧请求的停止操作不影响新请求', async () => {
  const closed: string[] = []; let calls = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _part of req) {} const id = String(++calls); res.on('close', () => closed.push(id));
    res.setHeader('Content-Type', 'text/event-stream'); res.write(delta('已收到的文字保留'));
  });
  const base = await listen(upstream); const backend = createServer(createStreamingApp({ API_BASE_URL: base, API_KEY: 'test-key', MODEL: 'stream-test' })); const url = await listen(backend);
  const stop = (id: string) => fetch(`${url}/api/streaming/${id}/stop`, { method: 'POST' });
  try {
    const first = await client(url, 'first-run', async (event) => { if (event.type === 'text-delta') await stop('first-run'); });
    assert.equal(first.record.state, 'stopped'); assert.equal(calls, 1); assert(first.events.some((event) => event.type === 'abort')); assert(!first.events.some((event) => event.type === 'finish'));
    assert.equal(first.record.stages[0].usage, null); assert.equal(first.record.stages[0].finishReason, null);
    const second = await client(url, 'second-run', async (event) => {
      if (event.type !== 'text-delta') return;
      await stop('first-run');
      const stillRunning = await (await fetch(`${url}/api/streaming/second-run/record`)).json() as RunRecord;
      assert.equal(stillRunning.state, 'running'); await stop('second-run');
    });
    assert.equal(second.record.state, 'stopped'); assert.equal(calls, 2);
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(closed.sort(), ['1', '2']);
  } finally { await close(backend); await close(upstream); }
});

test('供应商未报告用量时保持未知，不能用SDK默认值冒充零用量', async () => {
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _part of req) {} calls++;
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(delta(calls === 1 ? '仍有事项待定。' : '1. 何时确定开放时间？\n2. 谁负责安排？') + delta('', 'stop') + 'data: [DONE]\r\n\r\n');
  });
  const base = await listen(upstream); const backend = createServer(createStreamingApp({ API_BASE_URL: base, API_KEY: 'test-key', MODEL: 'stream-test' })); const url = await listen(backend);
  try {
    const result = await client(url, 'unknown-usage');
    assert.equal(result.record.state, 'completed'); assert.equal(calls, 2);
    assert(result.record.stages.every((stage) => stage.usage === null));
    assert(result.message.metadata?.stages.every((stage) => stage.usage === null));
  } finally { await close(backend); await close(upstream); }
});

test('浏览器断开会取消当前上游，不继续第二阶段', async () => {
  let calls = 0; let reportClosed!: () => void;
  const upstreamClosed = new Promise<void>((resolve) => { reportClosed = resolve; });
  const upstream = createServer(async (req, res) => { for await (const _part of req) {} calls++; res.on('close', reportClosed); res.setHeader('Content-Type', 'text/event-stream'); res.write(delta('摘要片段')); });
  const base = await listen(upstream); const backend = createServer(createStreamingApp({ API_BASE_URL: base, API_KEY: 'test-key', MODEL: 'stream-test' })); const url = await listen(backend);
  try {
    const controller = new AbortController();
    const response = await fetch(`${url}/api/streaming/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'disconnect-run', material: '阅读材料' }), signal: controller.signal });
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let received = '';
    while (!received.includes('text-delta')) { const part = await reader.read(); assert(!part.done); received += decoder.decode(part.value, { stream: true }); }
    controller.abort(); await upstreamClosed;
    const record = await (await fetch(`${url}/api/streaming/disconnect-run/record`)).json() as RunRecord;
    assert.equal(record.state, 'stopped'); assert.equal(calls, 1); assert(!record.uiEvents.some(({ event }) => event.type === 'finish'));
  } finally { await close(backend); await close(upstream); }
});
