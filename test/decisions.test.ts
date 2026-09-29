import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/server.ts';
import { parseOptions } from '../src/decisions/parse.ts';
import { chooseOption, clearSelection, editDraft, emptyDecision, type Options, type DecisionResponse } from '../src/decisions/contract.ts';
import { requestBody } from '../src/decisions/scenario.ts';

const options: Options = [
  { direction: '信息优先', title: '测试标题甲', text: '测试桩文案甲', reason: '便于查安排', tradeoff: '情境描写较少', unknowns: '报名方式待确认' },
  { direction: '参与感优先', title: '测试标题乙', text: '测试桩文案乙', reason: '先描写参与体验', tradeoff: '需要留意信息是否清晰', unknowns: '报名方式待确认' },
];
async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('只接收完整的两项JSON契约，不修复围栏、缺字段或额外方案', () => {
  const raw = JSON.stringify({ options }); assert.deepEqual(parseOptions(raw, 'stop'), options);
  assert.throws(() => parseOptions(raw, 'length'), { code: 'MODEL_RESPONSE_INCOMPLETE' });
  for (const invalid of [
    `\`\`\`json\n${raw}\n\`\`\``,
    JSON.stringify({ options: [...options, options[0]] }),
    JSON.stringify({ options: [options[0], { ...options[1], tradeoff: null }] }),
    JSON.stringify({ options: [options[0], { ...options[1], unknowns: '' }] }),
  ]) assert.throws(() => parseOptions(invalid, 'stop'), { code: 'MODEL_RESPONSE_INVALID' });
});

test('人工编辑不修改模型原稿；换选和不采用后仍保留本页编辑内容', () => {
  const originals = JSON.stringify(options);
  let state = emptyDecision(); assert.equal(state.selected, null);
  state = chooseOption(state, options, 0); state = editDraft(state, 'text', '人修改后的正文');
  assert.equal(state.drafts[0]?.text, '人修改后的正文'); assert.equal(JSON.stringify(options), originals);
  state = chooseOption(state, options, 1); assert.equal(state.drafts[1]?.text, options[1].text);
  state = clearSelection(state, false); assert.equal(state.status, 'unselected'); assert.equal(state.selected, null);
  state = clearSelection(state, true); assert.equal(state.status, 'rejected'); assert.equal(state.selected, null);
  assert.equal(state.drafts[0]?.text, '人修改后的正文'); assert.equal(JSON.stringify(options), originals);
  state = chooseOption(state, options, 0); assert.equal(state.status, 'editing'); assert.equal(state.drafts[0]?.text, '人修改后的正文');
});

test('实际HTTP请求与记录同串；结构失败保留原始输出且没有假方案或自动重试', async () => {
  // HTTP桩只验证协议，不提供真实文案供课程采用。
  const received: string[] = [];
  const outputs = [JSON.stringify({ options }), '{"options":[]}'];
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part; received.push(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'qwen-flash-test', choices: [{ message: { role: 'assistant', content: outputs[received.length - 1] }, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 150 } }));
  });
  const baseUrl = await listen(upstream);
  const backend = createServer(createApp({ API_BASE_URL: baseUrl, API_KEY: 'test-private-key', MODEL: 'qwen-flash' }, () => {})); const url = await listen(backend);
  try {
    const call = () => fetch(`${url}/api/decisions/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const first = await call(); assert.equal(first.status, 200);
    const success = await first.json() as DecisionResponse;
    assert.deepEqual(success.run.options, options); assert.equal(success.run.request?.requestBody, received[0]);
    assert.deepEqual(JSON.parse(received[0]), JSON.parse(requestBody('qwen-flash'))); assert.deepEqual(JSON.parse(received[0]).response_format, { type: 'json_object' });
    const second = await call(); assert.equal(second.status, 502);
    const failure = await second.json() as DecisionResponse;
    assert.equal(failure.ok, false); assert.equal(failure.run.options, null); assert.equal(failure.run.error?.code, 'MODEL_RESPONSE_INVALID');
    assert.deepEqual(failure.run.request?.responseMessage, { role: 'assistant', content: outputs[1] });
    assert.equal(received.length, 2); assert(!JSON.stringify([success, failure]).includes('test-private-key')); assert(!JSON.stringify([success, failure]).includes(baseUrl));
  } finally { await close(backend); await close(upstream); }
});
