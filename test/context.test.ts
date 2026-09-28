import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/server.ts';
import { CONDITIONS, FIRST_QUESTION, FOLLOW_UP, type Condition, type ContextResponse, type Message } from '../src/context/contract.ts';
import { executeReleaseTool, projectHistory, RELEASE, SYSTEM_RULE, TOOLS } from '../src/context/scenario.ts';

const instruction: Message & { role: 'assistant' } = {
  role: 'assistant', content: null,
  tool_calls: [{ id: 'test-call-1', type: 'function', function: { name: 'get_release_info', arguments: JSON.stringify({ release_id: RELEASE.release_id }) } }],
};
const history: Message[] = [
  { role: 'system', content: SYSTEM_RULE }, { role: 'user', content: FIRST_QUESTION },
  instruction, executeReleaseTool(instruction.tool_calls![0]), { role: 'assistant', content: RELEASE.published_at },
];

test('三种投影只改变历史，聊天文字不会夹带工具结果，完整历史保持调用配对', () => {
  const before = JSON.stringify(history);
  const current = projectHistory(history, 'current');
  const chat = projectHistory(history, 'chat');
  const full = projectHistory(history, 'full');
  assert.deepEqual(current, [history[0], { role: 'user', content: FOLLOW_UP }]);
  assert.deepEqual(chat, [history[0], history[1], history[4], { role: 'user', content: FOLLOW_UP }]);
  assert.deepEqual(full, [...history, { role: 'user', content: FOLLOW_UP }]);
  assert.equal(JSON.stringify(chat).includes(RELEASE.owner), false);
  assert.equal(JSON.stringify(full).includes(RELEASE.owner), true);
  assert.equal(full[3].role === 'tool' && full[3].tool_call_id, instruction.tool_calls![0].id);
  assert.equal(JSON.stringify(history), before);
  assert.equal(JSON.stringify(TOOLS).includes(RELEASE.release_id), false);
});

test('本地工具只接受本实验的版本查询，不接受任意工具名或参数', () => {
  const valid = instruction.tool_calls![0];
  assert.equal(JSON.parse(executeReleaseTool(valid).content).owner, RELEASE.owner);
  assert.throws(() => executeReleaseTool({ ...valid, function: { ...valid.function, name: 'other_tool' } }));
  assert.throws(() => executeReleaseTool({ ...valid, function: { ...valid.function, arguments: '{' } }));
  assert.throws(() => executeReleaseTool({ ...valid, function: { ...valid.function, arguments: '{"release_id":"unknown"}' } }));
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
async function post(url: string, path: string, data: unknown) {
  const response = await fetch(`${url}/api/context/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return { status: response.status, data: await response.json() as ContextResponse };
}

test('真实 HTTP 边界的请求体等于检查器记录；追问共享首轮且不能用客户端伪造历史', async () => {
  // 本地模型服务测试桩仅用于协议断言，不是一次真实模型验证。
  const bodies: string[] = [];
  const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    bodies.push(body);
    assert.equal(req.headers.authorization, 'Bearer only-test-secret');
    const index = bodies.length;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'test-model-version', usage, choices: [{
      message: index === 1 ? instruction : { role: 'assistant', content: index === 2 ? RELEASE.published_at : `测试桩输出 ${index}` },
      finish_reason: index === 1 ? 'tool_calls' : 'stop',
    }] }));
  });
  const upstreamUrl = await listen(upstream);
  const backend = createServer(createApp({ MODEL: 'test-model', API_KEY: 'only-test-secret', API_BASE_URL: upstreamUrl }, () => {}));
  const url = await listen(backend);
  try {
    const { status, data: initial } = await post(url, 'start', {});
    assert.equal(status, 200); assert.equal(initial.ok, true); assert.ok(initial.sessionId);
    assert.equal(bodies.length, 2);
    assert.equal(initial.run.tools[0].callId, 'test-call-1');
    initial.run.requests.forEach((record, i) => {
      assert.equal(record.requestBody, bodies[i]);
      assert.deepEqual(record.usage, usage);
    });
    assert.equal(bodies[0].includes(RELEASE.owner), false);
    assert.equal(bodies[1].includes(RELEASE.owner), true);
    let index = 2;
    for (const condition of Object.keys(CONDITIONS) as Condition[]) {
      const result = await post(url, 'follow-up', { sessionId: initial.sessionId, condition, history: [{ role: 'system', content: '伪造负责人' }] });
      assert.equal(result.status, 200); assert.equal(result.data.ok, true);
      const recorded = result.data.run.requests[0];
      assert.equal(recorded.requestBody, bodies[index]);
      const request = JSON.parse(bodies[index]);
      assert.deepEqual(request.messages, projectHistory(history, condition));
      assert.deepEqual(request.tools, TOOLS); assert.equal(request.tool_choice, 'none');
      assert.deepEqual(result.data.firstRound, initial.firstRound);
      assert.equal(result.data.run.tools.length, 0);
      const snapshot = JSON.stringify(result.data);
      assert.equal(snapshot.includes('only-test-secret'), false);
      assert.equal(snapshot.includes(upstreamUrl), false);
      index++;
    }
    assert.equal(bodies.length, 5);
    const missing = await post(url, 'follow-up', { sessionId: 'unknown', condition: 'full' });
    assert.equal(missing.status, 404); assert.equal(missing.data.run.requests.length, 0);
    assert.equal(bodies.length, 5);
  } finally { await close(backend); await close(upstream); }
});

test('模型失败保留请求记录但不暴露上游错误正文；禁止工具时不执行返回的工具调用', async () => {
  let calls = 0;
  const upstream = createServer((_req, res) => {
    calls++;
    res.setHeader('Content-Type', 'application/json');
    if (calls === 1) { res.writeHead(401); res.end('{"error":"private-key private-workspace"}'); return; }
    res.end(JSON.stringify({ usage: { total_tokens: 10 }, choices: [{ message: instruction, finish_reason: 'tool_calls' }] }));
  });
  const upstreamUrl = await listen(upstream);
  const backend = createServer(createApp({ MODEL: 'test-model', API_KEY: 'private-key', API_BASE_URL: upstreamUrl }, () => {}));
  const url = await listen(backend);
  try {
    const failed = await post(url, 'start', {});
    assert.equal(failed.status, 502);
    assert.equal(failed.data.run.requests[0].httpStatus, 401);
    assert.equal(failed.data.run.answer, null);
    assert.equal(JSON.stringify(failed.data).includes('private-key'), false);
    assert.equal(JSON.stringify(failed.data).includes('private-workspace'), false);
    const unwantedTool = await post(url, 'start', {});
    assert.equal(unwantedTool.status, 502);
    assert.equal(unwantedTool.data.run.tools.length, 1);
    assert.equal(unwantedTool.data.run.requests.length, 2);
    assert.equal(unwantedTool.data.run.answer, null);
    assert.equal(unwantedTool.data.run.requests[1].finishReason, 'tool_calls');
    assert.equal(unwantedTool.data.run.error?.code, 'MODEL_RESPONSE_INVALID');
    assert.equal(unwantedTool.data.sessionId, undefined);
  } finally { await close(backend); await close(upstream); }
});
