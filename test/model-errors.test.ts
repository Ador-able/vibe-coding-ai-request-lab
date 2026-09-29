import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { askModel, ModelError } from '../src/model.ts';
import { sendRecordedRequest } from '../src/recorded-model.ts';
import { streamModel } from '../src/latency/model.ts';
import { streamStage } from '../src/streaming/model.ts';
import type { RequestRecord } from '../src/context/contract.ts';
import type { StreamRecord } from '../src/latency/contract.ts';
import type { StageRecord } from '../src/streaming/contract.ts';

test('四条SDK调用路径区分HTTP失败与HTTP成功后的无效正文，且不重试', async () => {
  // 本地响应只验证SDK错误边界，不代表模型的真实回答。
  let status = 200; let body = '{'; let calls = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* 消费本次测试请求。 */ }
    calls++; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const config = { baseUrl: `http://127.0.0.1:${address.port}`, model: 'test-model', apiKey: 'test-key' };
  const requestBody = JSON.stringify({ model: config.model, messages: [{ role: 'user', content: '测试' }], max_tokens: 16 });
  try {
    for (const scenario of ['invalid-json', 'invalid-shape', 'http'] as const) {
      status = scenario === 'http' ? 401 : 200;
      body = scenario === 'invalid-json' ? '{' : scenario === 'invalid-shape'
        ? JSON.stringify({ choices: [{ message: { content: 7 }, finish_reason: 'stop' }] })
        : JSON.stringify({ error: { message: 'test-private-error' } });
      const recorded: RequestRecord = { step: '测试', startedAt: '', requestBody };
      const latency: StreamRecord = { id: 'test', condition: 'short', startedAt: '', requestBody, httpStatus: null,
        responseModel: null, answer: '', events: [], firstContentMs: null, streamEndMs: null, endedBy: null, finishReason: null, usage: null };
      const streaming: StageRecord = { id: 'test', stage: 'summary', offsetMs: 0, startedAt: '', requestBody: '', httpStatus: null,
        responseModel: null, answer: '', providerChunks: [], firstContentMs: null, streamEndMs: null, finishReason: null, sdkFinishReason: null, usage: null };
      const invoke = [
        () => askModel('测试', config, AbortSignal.timeout(2000)),
        () => sendRecordedRequest(config, recorded, AbortSignal.timeout(2000)),
        () => streamModel(config, latency, AbortSignal.timeout(2000), () => {}),
        () => streamStage(config, streaming, '测试材料', '', AbortSignal.timeout(2000), () => {}),
      ];
      for (const run of invoke) {
        const before = calls;
        await assert.rejects(run, (error: unknown) => {
          assert.ok(error instanceof ModelError);
          assert.equal(error.code, status === 200 ? 'MODEL_RESPONSE_INVALID' : 'MODEL_HTTP_ERROR');
          assert.equal(error.modelHttpStatus, status);
          assert.equal(error.message.includes('test-private-error'), false);
          if (status === 200) assert.doesNotMatch(error.message, /权限|额度/);
          return true;
        });
        assert.equal(calls - before, 1);
      }
      if (scenario === 'invalid-shape') assert.deepEqual(recorded.responseMessage, { content: 7 });
    }
  } finally {
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }
});
