import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/server.ts';
import { askModel, ModelError } from '../src/model.ts';
import type { AskResult } from '../src/contract.ts';

// 测试桩只检查协议与失败处理，不代表真实模型调用成功。
async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function send(baseUrl: string, question = '  解释一下 API  '): Promise<{ status: number; body: AskResult }> {
  const response = await fetch(`${baseUrl}/api/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }),
  });
  return { status: response.status, body: await response.json() as AskResult };
}

test('问题按协议转发，回答和实际阶段返回，密钥与 Base URL 留在后端', async () => {
  const secret = 'test-only-secret';
  let received: { path?: string; authorization?: string; body?: unknown } = {};
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = { path: req.url, authorization: req.headers.authorization, body: JSON.parse(body) };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '测试桩回答' }, finish_reason: 'stop' }] }));
  });
  const upstreamUrl = await listen(upstream);
  const logs: string[] = [];
  const backend = createServer(createApp({ API_BASE_URL: `${upstreamUrl}/workspace/compatible-mode/v1/`, MODEL: 'test-model', API_KEY: secret }, (line) => logs.push(line)));
  const backendUrl = await listen(backend);
  try {
    const { status, body } = await send(backendUrl);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    if (body.ok) assert.equal(body.answer, '测试桩回答');
    assert.equal(received.path, '/workspace/compatible-mode/v1/chat/completions');
    assert.equal(received.authorization, `Bearer ${secret}`);
    assert.deepEqual(received.body, {
      model: 'test-model', messages: [{ role: 'system', content: '请用简洁的中文回答问题。' }, { role: 'user', content: '解释一下 API' }],
      stream: false, enable_thinking: false, max_tokens: 1024,
    });
    assert.deepEqual(body.trace.stages.map((stage) => stage.name), ['收到请求', '请求模型', '收到模型回复', '返回页面']);
    assert.equal(body.trace.modelHttpStatus, 200);
    assert.ok(typeof body.trace.modelDurationMs === 'number');
    for (const text of [JSON.stringify(body), logs.join('\n')]) {
      assert.equal(text.includes(secret), false);
      assert.equal(text.includes(upstreamUrl), false);
    }
  } finally { await close(backend); await close(upstream); }
});

test('缺配置时不会伪造模型阶段，空问题也不进入模型请求', async () => {
  const backend = createServer(createApp({}, () => {}));
  const url = await listen(backend);
  try {
    const missing = await send(url);
    assert.equal(missing.status, 503);
    assert.equal(missing.body.ok, false);
    if (!missing.body.ok) assert.equal(missing.body.error.code, 'CONFIG_MISSING');
    assert.deepEqual(missing.body.trace.stages.map((stage) => stage.name), ['收到请求', '返回页面']);
    const invalid = await send(url, ' ');
    assert.equal(invalid.status, 400);
    if (!invalid.body.ok) assert.equal(invalid.body.error.code, 'INVALID_QUESTION');
  } finally { await close(backend); }
});

test('模型 HTTP 失败只返回状态与建议，不泄露原始错误正文', async () => {
  const upstream = createServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'test-only-secret /private-workspace/path' } }));
  });
  const upstreamUrl = await listen(upstream);
  const backend = createServer(createApp({ API_BASE_URL: upstreamUrl, API_KEY: 'test-only-secret', MODEL: 'test-model' }, () => {}));
  const url = await listen(backend);
  try {
    const { status, body } = await send(url);
    assert.equal(status, 502);
    assert.equal(body.ok, false);
    if (!body.ok) assert.equal(body.error.code, 'MODEL_HTTP_ERROR');
    assert.equal(body.trace.modelHttpStatus, 401);
    assert.equal('answer' in body, false);
    assert.equal(JSON.stringify(body).includes('test-only-secret'), false);
    assert.equal(JSON.stringify(body).includes('/private-workspace/path'), false);
  } finally { await close(backend); await close(upstream); }
});

test('等待模型超时会中止请求；网络不可达单独归类', async () => {
  const upstream = createServer(() => {});
  const url = await listen(upstream);
  const config = { baseUrl: url, model: 'test-model', apiKey: 'test-only-secret' };
  try {
    await assert.rejects(askModel('问题', config, AbortSignal.timeout(30)), (error: unknown) => error instanceof ModelError && error.code === 'MODEL_TIMEOUT');
  } finally { await close(upstream); }
  await assert.rejects(askModel('问题', config, AbortSignal.timeout(1000)), (error: unknown) => error instanceof ModelError && error.code === 'MODEL_NETWORK_ERROR');
});
