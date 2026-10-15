import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import express from 'express';
import { createMessageHistoryRouter } from '../src/message-history/routes.ts';

test('回显消息的人工校正能保存读回，并只按P2约定进入模型输入', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fanren-message-feedback-'));
  const messages = await createMessageHistoryRouter(directory);
  const app = express(); app.use('/api/messages', messages.router);
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/messages`;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  try {
    // 完整与停止原件共用同一保存和转换入口；全过程不调用模型。
    for (const fixtureKey of ['normal', 'stopped']) {
      const created = await post('/conversations', { fixtureKey });
      const id = created.view.conversation.id;
      const imported = await post(`/conversations/${id}/import`, { phase: 'final' });
      const assistant = imported.view.messages.find((message: { role: string }) => message.role === 'assistant');
      const note = `${fixtureKey}：原文回显不算生成摘要，先核引用与状态。`;
      await post(`/conversations/${id}/feedback`, { note });
      const reread = await (await fetch(`${url}/conversations/${id}`)).json();
      const feedback = reread.messages.at(-1).parts[0];
      assert.deepEqual(feedback, { type: 'data-review-note', data: { targetMessageId: assistant.id, text: note } });
      const prepared = await post(`/conversations/${id}/prepare`, {});
      assert.equal(JSON.stringify(prepared.projections.P0.modelMessages).includes(note), false);
      assert.equal(JSON.stringify(prepared.projections.P1.modelMessages).includes(note), false);
      assert.equal(JSON.stringify(prepared.projections.P2.modelMessages).includes(note), true);
      assert.equal(prepared.excluded.length, fixtureKey === 'stopped' ? 1 : 0);
      assert.equal(prepared.modelCalled, false);
    }
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    messages.close();
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
