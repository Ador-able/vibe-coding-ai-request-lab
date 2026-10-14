import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('页面配置即时用于同一服务的各实验，留空保留密钥，重启复用且接口和记录不回传密钥', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibe-settings-')); const path = join(directory, 'model.json');
  const secret = 'only-local-test-key'; const received: { authorization?: string; body: { model: string } }[] = [];
  const upstream = createServer(async (req, res) => {
    req.setEncoding('utf8'); let body = ''; for await (const chunk of req) body += chunk;
    received.push({ authorization: req.headers.authorization, body: JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' }, finish_reason: 'stop' }] }));
  });
  const baseUrl = await listen(upstream);
  let backend = createServer(createApp(undefined, () => {}, path)); let url = await listen(backend);
  const save = (value: unknown) => fetch(`${url}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const config = { baseUrl, model: 'first-model', structuredModel: 'schema-model', embeddingModel: 'my-vector-model', apiKey: secret };
  try {
    const empty = await (await fetch(`${url}/api/config`)).json();
    assert.equal(empty.hasKey, false); assert.equal(empty.baseUrl, ''); assert.equal(empty.model, '');
    const saved = await save(config); assert.equal(saved.status, 200); assert(!(await saved.text()).includes(secret));
    const ask = async () => {
      const response = await fetch(`${url}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: '测试问题' }) });
      assert.equal(response.status, 200); assert(!(await response.text()).includes(secret));
    };
    await ask(); assert.equal(received.at(-1)?.body.model, 'first-model');
    assert.equal((await save({ ...config, model: 'second-model', apiKey: '' })).status, 200);
    await ask(); assert.equal(received.at(-1)?.body.model, 'second-model'); assert.equal(received.at(-1)?.authorization, `Bearer ${secret}`);
    assert.equal((await save({ ...config, baseUrl: 'ftp://invalid', apiKey: '' })).status, 400);
    const structured = await fetch(`${url}/api/structured/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'prompt', material: '本次没有待办' }) });
    assert.equal(structured.status, 200); assert(!(await structured.text()).includes(secret));
    assert.equal(received.at(-1)?.body.model, 'schema-model');
    assert.equal((await (await fetch(`${url}/api/streaming/info`)).json()).model, 'second-model');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).apiKey, secret);
    await close(backend);
    backend = createServer(createApp(undefined, () => {}, path)); url = await listen(backend);
    const reread = await (await fetch(`${url}/api/config`)).json();
    assert.equal(reread.hasKey, true); assert.equal(reread.model, 'second-model'); assert(!JSON.stringify(reread).includes(secret));
    await ask(); assert.equal(received.at(-1)?.body.model, 'second-model');
    assert.equal(reread.embeddingModel, 'my-vector-model');
    assert.equal((await save({ baseUrl, model: 'custom-third-model', apiKey: '' })).status, 200);
    const shared = await fetch(`${url}/api/structured/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'prompt', material: '本次没有待办' }) });
    assert.equal(shared.status, 200); assert.equal(received.at(-1)?.body.model, 'custom-third-model');
  } finally { await close(backend); await close(upstream); await rm(directory, { recursive: true, force: true }); }
});
