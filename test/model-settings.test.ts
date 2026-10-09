import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { createModelSettings } from '../src/model-settings.ts';
import { modelName } from '../src/structured/request.ts';

test('自选兼容接口保存一次，重建服务后共用；结构化默认沿用所选模型', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'course-model-')), 'model.json');
  const settings = createModelSettings(path);
  const app = express(); app.use(express.json()); app.use('/api/config', settings.router);
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/config`;
  try {
    const empty = await (await fetch(url)).json();
    assert.equal(empty.baseUrl, ''); assert.equal(empty.model, ''); assert.equal(empty.hasKey, false);
    const body = { baseUrl: 'https://example.com/v1', apiKey: 'test-private-key', model: 'my-chat-model', embeddingModel: 'my-vector-model' };
    const saved = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(saved.status, 200); const receipt = await saved.json();
    assert.equal(receipt.model, body.model); assert.equal(receipt.hasKey, true);
    assert(!JSON.stringify(receipt).includes(body.apiKey));
    const reopened = createModelSettings(path);
    assert.equal(reopened.env.API_BASE_URL, body.baseUrl); assert.equal(reopened.env.MODEL, body.model);
    assert.equal(reopened.env.EMBEDDING_MODEL, body.embeddingModel); assert.equal(modelName(reopened.env), body.model);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).apiKey, body.apiKey);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
