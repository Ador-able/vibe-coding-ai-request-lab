import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { ModelError } from '../src/model.ts';
import { streamModel } from '../src/latency/model.ts';
import { streamStage } from '../src/streaming/model.ts';
import type { StreamRecord } from '../src/latency/contract.ts';
import type { StageRecord } from '../src/streaming/contract.ts';

test('流中错误立即释放SDK上游连接，返回后的记录不再变化', async () => {
  // 故意保持HTTP桩打开，验证释放来自应用取消，而非测试服务主动结束。
  let response: ServerResponse | undefined; let closed: Promise<unknown> | undefined; let calls = 0;
  const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* 消费请求后开始本地测试流。 */ }
    calls++; response = res; closed = once(res, 'close');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(delta('已收到部分正文'));
    res.write('data: {"error":{"message":"测试上游错误"}}\n\n');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const config = { baseUrl: `http://127.0.0.1:${address.port}`, model: 'test-model', apiKey: 'test-key' };
  try {
    for (const path of ['latency', 'streaming'] as const) {
      const latency: StreamRecord = { id: 'test', condition: 'short', startedAt: '', requestBody: JSON.stringify({ model: config.model,
        messages: [{ role: 'user', content: '测试' }], max_tokens: 16 }), httpStatus: null, responseModel: null,
        answer: '', events: [], firstContentMs: null, streamEndMs: null, endedBy: null, finishReason: null, usage: null };
      const streaming: StageRecord = { id: 'test', stage: 'summary', offsetMs: 0, startedAt: '', requestBody: '', httpStatus: null,
        responseModel: null, answer: '', providerChunks: [], firstContentMs: null, streamEndMs: null, finishReason: null, sdkFinishReason: null, usage: null };
      const before = calls;
      await assert.rejects(path === 'latency'
        ? streamModel(config, latency, AbortSignal.timeout(2000), () => {})
        : streamStage(config, streaming, '材料', '', AbortSignal.timeout(2000), () => {}),
      (error: unknown) => error instanceof ModelError && error.code === 'MODEL_RESPONSE_INVALID');
      assert.equal(calls - before, 1);
      assert.ok(closed && response);
      assert.equal(await Promise.race([closed.then(() => true), wait(300).then(() => false)]), true);
      const record = path === 'latency' ? latency : streaming;
      assert.equal(record.answer, '已收到部分正文');
      const snapshot = structuredClone(record);
      response.write(delta('错误后的片段'));
      await wait(20);
      assert.deepEqual(record, snapshot);
    }
  } finally {
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }
});
