import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import express from 'express';
import { observeEvents, readEvents } from '../src/latency/sse.ts';
import { streamModel } from '../src/latency/model.ts';
import { createLatencyRouter } from '../src/latency/routes.ts';
import { MANUAL, TARGET, requestBody } from '../src/latency/materials.ts';
import { usageOf, type ClientEvent, type StreamRecord } from '../src/latency/contract.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
const chunk = (content: string, finish: string | null = null) => ({ model: 'qwen-flash-test', choices: [{ index: 0, delta: { content }, finish_reason: finish }] });
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
function record(): StreamRecord {
  return { id: 'test', condition: 'long', startedAt: '', requestBody: requestBody('long', 'qwen-flash'), responseModel: null,
    httpStatus: null, events: [], answer: '', firstContentMs: null, streamEndMs: null, endedBy: null, finishReason: null, usage: null };
}

test('受控材料保留同一事实；重复请求逐字一致，前缀条件只改变最前标记', () => {
  assert.equal((MANUAL.match(/【M\d+/g) ?? []).length, 40);
  assert.equal(MANUAL.split(TARGET).length, 2);
  assert.equal(requestBody('repeat', 'qwen-flash'), requestBody('long', 'qwen-flash'));
  assert.equal(requestBody('prefix', 'qwen-flash').replace('实验版本：B', '实验版本：A'), requestBody('long', 'qwen-flash'));
  const short = JSON.parse(requestBody('short', 'qwen-flash'));
  const long = JSON.parse(requestBody('long', 'qwen-flash'));
  assert.deepEqual(short.messages[0], long.messages[0]);
  assert.equal(short.messages[1].content.replace(TARGET, MANUAL), long.messages[1].content);
  assert.equal(long.stream, true); assert.deepEqual(long.stream_options, { include_usage: true });
  assert.equal(long.max_tokens, 96); assert.equal(long.temperature, 0); assert.equal(long.enable_thinking, false);
  assert.equal('cache_control' in long, false); assert.equal('tools' in long, false);
  const detailed = JSON.parse(requestBody('detailed', 'qwen-flash'));
  assert.ok(detailed.messages[1].content.includes(MANUAL)); assert.equal(detailed.max_tokens, 512);
});

test('SSE 解析跨字节与 CRLF 边界，合并多行 data，不补造半条事件', async () => {
  const source = ': heartbeat\r\nid: 7\r\nevent: message\r\ndata: 你好\r\ndata: 世界\r\n\r\ndata: [DONE]\r\n\r\ndata: 半条';
  const bytes = new TextEncoder().encode(source);
  const stream = () => new ReadableStream<Uint8Array>({ start(controller) {
    // 一字节一块，明确覆盖 UTF-8 汉字、\r\n 和事件分隔的断开。
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close();
  } });
  const received = []; for await (const event of readEvents(stream())) received.push(event);
  assert.deepEqual(received, [{ id: '7', event: 'message', data: '你好\n世界' }, { id: undefined, event: undefined, data: '[DONE]' }]);
  const observed: unknown[] = []; let ended = false;
  const passed = await new Response(observeEvents(stream(), (event) => observed.push(event), () => { ended = true; })).arrayBuffer();
  assert.deepEqual(new Uint8Array(passed), bytes); assert.deepEqual(observed, received); assert.equal(ended, true);
});

test('实际转发串等于检查器；首正文排除空块，接收 choices 空的用量块与 DONE', async () => {
  // 本地 HTTP 桩仅验证流协议与计时位置，不是模型性能实测。
  let sent = ''; let calls = 0;
  const upstream = createServer(async (req, res) => {
    calls++;
    for await (const part of req) sent += part;
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(frame({ model: 'qwen-flash-test', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
    await wait(35);
    res.write(frame(chunk('48小时'))); await wait(10);
    res.write(frame(chunk('。', 'stop')));
    res.write(frame({ model: 'qwen-flash-test', choices: [], usage: { prompt_tokens: 6000, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 4096 } } }));
    res.end('data: [DONE]\r\n\r\n');
  });
  const baseUrl = await listen(upstream);
  const app = express(); app.use(express.json()); app.use('/api/latency', createLatencyRouter({ API_BASE_URL: baseUrl, API_KEY: 'test-private-key', MODEL: 'qwen-flash' }));
  const backend = createServer(app); const url = await listen(backend);
  try {
    const response = await fetch(`${url}/api/latency/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"condition":"long"}' });
    const downstream: ClientEvent[] = []; for await (const event of readEvents(response.body!)) downstream.push(JSON.parse(event.data));
    const last = downstream.at(-1); assert.equal(last?.type, 'complete'); if (last?.type !== 'complete') throw new Error();
    const result = last.record;
    assert.equal(result.requestBody, sent); assert.equal(result.answer, '48小时。'); assert.equal(result.events.length, 5);
    assert.equal(calls, 1);
    assert.equal(result.firstContentMs, result.events[1].elapsedMs); assert.ok(result.firstContentMs > result.events[0].elapsedMs);
    assert.equal(result.streamEndMs, result.events[4].elapsedMs); assert.equal(result.endedBy, 'done'); assert.equal(result.finishReason, 'stop');
    assert.deepEqual(usageOf(result.usage), { input: 6000, output: 8, cached: 4096 });
    assert.equal(result.error, undefined); assert.equal(JSON.stringify(downstream).includes('test-private-key'), false);
    assert.equal(JSON.stringify(downstream).includes(baseUrl), false);
    assert.deepEqual(downstream.filter((event) => event.type === 'delta').map((event) => event.text), ['48小时', '。']);
  } finally { await close(backend); await close(upstream); }
});

test('取消穿过被动观测层中止同一次SDK请求，部分文字保留且不补造DONE', async () => {
  let calls = 0; let notifyClosed!: () => void;
  const closed = new Promise<void>((resolve) => { notifyClosed = resolve; });
  const upstream = createServer(async (req, res) => {
    for await (const _part of req) {} calls++;
    res.on('close', notifyClosed); res.setHeader('Content-Type', 'text/event-stream'); res.write(frame(chunk('部分正文')));
  });
  const baseUrl = await listen(upstream); const controller = new AbortController(); const partial = record();
  try {
    await assert.rejects(streamModel({ baseUrl, model: 'qwen-flash', apiKey: 'test-key' }, partial, controller.signal, () => controller.abort()), { code: 'REQUEST_CANCELLED' });
    await closed;
    assert.equal(calls, 1); assert.equal(partial.answer, '部分正文'); assert.notEqual(partial.firstContentMs, null);
    assert.equal(partial.streamEndMs, null); assert.equal(partial.endedBy, null); assert.equal(partial.usage, null);
    assert(partial.events.every((event) => event.data !== '[DONE]'));
  } finally { await close(upstream); }
});

test('缺用量或缓存保持未知；正常 EOF 可结束，截断与不完整回答不报完成', async () => {
  let index = 0;
  const upstream = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    const finish = [ 'stop', 'length', null ][index++];
    res.end(frame(chunk('部分文字', finish)));
  });
  const baseUrl = await listen(upstream);
  const config = { baseUrl, model: 'qwen-flash', apiKey: 'test-only-key' };
  try {
    const complete = record(); await streamModel(config, complete, AbortSignal.timeout(5000), () => {});
    assert.equal(complete.endedBy, 'eof'); assert.equal(complete.usage, null); assert.ok(complete.streamEndMs !== null);
    assert.deepEqual(usageOf(complete.usage), { input: null, output: null, cached: null });
    assert.equal(usageOf({ prompt_tokens: 1, completion_tokens: 2 }).cached, null);
    assert.equal(usageOf({ prompt_tokens_details: { cached_tokens: 0 } }).cached, 0);
    for (const finish of ['length', null]) {
      const partial = record();
      await assert.rejects(streamModel(config, partial, AbortSignal.timeout(5000), () => {}), { code: 'MODEL_RESPONSE_INCOMPLETE' });
      assert.equal(partial.answer, '部分文字'); assert.equal(partial.finishReason, finish); assert.equal(partial.error?.code, 'MODEL_RESPONSE_INCOMPLETE');
    }
  } finally { await close(upstream); }
});
