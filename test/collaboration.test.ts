import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/server.ts';
import { SYSTEM, INITIAL_TASK } from '../src/collaboration/scenario.ts';
import { acceptTurn, type CollaborationResponse, type Turn } from '../src/collaboration/contract.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
const message = (answer: string, finish = 'stop') => ({ model: 'qwen-flash-test', choices: [{ message: { role: 'assistant', content: answer }, finish_reason: finish }], usage: { prompt_tokens: 200, completion_tokens: 80 } });
async function turn(url: string, input: string, history: Turn[]) {
  const response = await fetch(`${url}/api/collaboration/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, history }) });
  return { status: response.status, data: await response.json() as CollaborationResponse };
}

test('自由反馈与之前原始回答完整进入下一轮，实际请求与检查器同串', async () => {
  // 只以本地 HTTP 桩核对对话传输，不把桩文字当作模型共写效果。
  const received: string[] = [];
  const answers = ['方向甲：一起读。\n方向乙：分享一本书。', '按读者的取舍整理的新文字。'];
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part; received.push(body);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(message(answers[received.length - 1])));
  });
  const baseUrl = await listen(upstream);
  const backend = createServer(createApp({ API_BASE_URL: baseUrl, API_KEY: 'test-only-private-key', MODEL: 'qwen-flash' }, () => {}));
  const url = await listen(backend);
  try {
    let history: Turn[] = [];
    const first = await turn(url, INITIAL_TASK, history); assert.equal(first.status, 200);
    assert.equal(first.data.result.answer, answers[0]); history = acceptTurn(history, first.data.result);
    const feedback = '我选择第二种方向。\n我们服务的家庭更在意共同参与，请写得温和，不制造稀缺感。';
    const second = await turn(url, feedback, history); assert.equal(second.status, 200);
    history = acceptTurn(history, second.data.result);
    assert.deepEqual(history, [{ input: INITIAL_TASK, answer: answers[0] }, { input: feedback, answer: answers[1] }]);
    const request = JSON.parse(received[1]);
    assert.deepEqual(request.messages, [{ role: 'system', content: SYSTEM }, { role: 'user', content: INITIAL_TASK }, { role: 'assistant', content: answers[0] }, { role: 'user', content: feedback }]);
    assert.equal(request.enable_thinking, false); assert.equal(request.temperature, 0); assert.equal(request.max_tokens, 1536);
    assert.equal(first.data.result.request?.requestBody, received[0]); assert.equal(second.data.result.request?.requestBody, received[1]);
    assert.equal(JSON.stringify([first, second]).includes('test-only-private-key'), false);
    assert.equal(JSON.stringify([first, second]).includes(baseUrl), false);
  } finally { await close(backend); await close(upstream); }
});

test('失败和截断保留实际记录，不进入成功历史，也不丢弃先前成功消息', async () => {
  const received: string[] = [];
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part; received.push(body);
    res.setHeader('Content-Type', 'application/json');
    if (received.length === 1) { res.statusCode = 429; res.end('{"error":"不应公开的测试服务商错误"}'); }
    else res.end(JSON.stringify(message(received.length === 2 ? '完整初稿' : received.length === 3 ? '未完成片段' : '完整改写', received.length === 3 ? 'length' : 'stop')));
  });
  const baseUrl = await listen(upstream);
  const backend = createServer(createApp({ API_BASE_URL: baseUrl, API_KEY: 'test-only-key', MODEL: 'qwen-flash' }, () => {}));
  const url = await listen(backend);
  try {
    let history: Turn[] = [];
    const failed = await turn(url, INITIAL_TASK, history);
    assert.equal(failed.status, 502); assert.equal(failed.data.result.request?.httpStatus, 429);
    history = acceptTurn(history, failed.data.result); assert.deepEqual(history, []);
    assert(!JSON.stringify(failed).includes('不应公开的测试服务商错误'));
    const first = await turn(url, INITIAL_TASK, history); history = acceptTurn(history, first.data.result);
    const incomplete = await turn(url, '请换一种语气。', history);
    assert.equal(incomplete.data.result.error?.code, 'MODEL_RESPONSE_INCOMPLETE');
    assert.deepEqual(incomplete.data.result.request?.responseMessage, { role: 'assistant', content: '未完成片段' });
    assert.equal(incomplete.data.result.answer, null);
    history = acceptTurn(history, incomplete.data.result);
    assert.deepEqual(history, [{ input: INITIAL_TASK, answer: '完整初稿' }]);
    const next = await turn(url, '保留共读主题，用更朴素的语言。', history);
    const messages = JSON.parse(next.data.result.request!.requestBody).messages;
    assert.equal(messages.length, 4); assert.equal(messages[1].content, INITIAL_TASK); assert.equal(messages[2].content, '完整初稿');
    assert(!next.data.result.request!.requestBody.includes('未完成片段')); assert(!next.data.result.request!.requestBody.includes('请换一种语气。'));
    assert.equal(received.length, 4); assert.equal(next.data.result.round, 2);
  } finally { await close(backend); await close(upstream); }
});

test('外部入口拒绝不完整历史和过长正文，不悄悄裁剪消息', async () => {
  const backend = createServer(createApp({}, () => {})); const url = await listen(backend);
  try {
    for (const body of [{ input: '新的反馈', history: [{ input: '旧任务' }] }, { input: ' ', history: [] }]) {
      const response = await fetch(`${url}/api/collaboration/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
    }
    const tooLarge = await fetch(`${url}/api/collaboration/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: '新反馈', history: [{ input: '完整旧任务', answer: '长'.repeat(45000) }] }) });
    assert.equal(tooLarge.status, 413); assert.match((await tooLarge.json()).error, /不会自动删减历史/);
  } finally { await close(backend); }
});
