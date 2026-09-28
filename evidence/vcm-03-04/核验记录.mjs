import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// 只核对随仓库保存的记录，不访问网络、密钥或运行中的服务。
const bytes = fs.readFileSync(new URL('./流式等待-实际请求记录.json', import.meta.url));
const data = JSON.parse(bytes);
const saved = JSON.parse(fs.readFileSync(new URL('./实际记录核验.json', import.meta.url), 'utf8'));
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256, saved.recordSha256);
assert.equal(data.runs.length, 5);
const conditions = ['short', 'long', 'repeat', 'prefix', 'detailed'];
const rows = data.runs.map((attempt, index) => {
  assert.equal(attempt.condition, conditions[index]);
  assert.equal(attempt.settled, true);
  assert.equal(attempt.transportError, null);
  const record = attempt.record;
  assert.equal(record.condition, conditions[index]);
  assert.equal(record.error, undefined);
  assert.equal(record.httpStatus, 200);
  assert.equal(record.endedBy, 'done');
  assert.equal(record.finishReason, 'stop');
  const request = JSON.parse(record.requestBody);
  assert.equal(request.model, 'qwen-flash');
  assert.equal(request.stream, true);
  assert.deepEqual(request.stream_options, { include_usage: true });
  assert.equal(request.enable_thinking, false);
  assert.equal(request.temperature, 0);
  assert.equal(request.max_tokens, index === 4 ? 512 : 96);
  let first = null;
  let answer = '';
  let usage = null;
  let finish = null;
  let previousTime = -1;
  for (const event of record.events) {
    assert(event.elapsedMs >= previousTime);
    previousTime = event.elapsedMs;
    if (event.data === '[DONE]') continue;
    const payload = JSON.parse(event.data);
    if (payload.usage) usage = payload.usage;
    const choice = payload.choices?.[0];
    if (typeof choice?.finish_reason === 'string') finish = choice.finish_reason;
    const content = choice?.delta?.content;
    if (typeof content === 'string' && content.length) {
      first ??= event.elapsedMs;
      answer += content;
    }
  }
  assert.equal(answer, record.answer);
  assert.equal(first, record.firstContentMs);
  assert.equal(finish, record.finishReason);
  assert.equal(record.events.at(-1).data, '[DONE]');
  assert.equal(record.events.at(-1).elapsedMs, record.streamEndMs);
  assert.deepEqual(usage, record.usage);
  assert.equal(usage.total_tokens, usage.prompt_tokens + usage.completion_tokens);
  assert(usage.prompt_tokens_details.cached_tokens <= usage.prompt_tokens);
  assert.match(answer, /48\s*小时/);
  return { condition: record.condition, firstContentMs: first, streamEndMs: record.streamEndMs,
    input: usage.prompt_tokens, cached: usage.prompt_tokens_details.cached_tokens, output: usage.completion_tokens,
    events: record.events.length, finishReason: finish, answer };
});
const records = data.runs.map((attempt) => attempt.record);
assert.equal(records[1].requestBody, records[2].requestBody);
assert.equal(records[1].requestBody.replace('实验版本：A', '实验版本：B'), records[3].requestBody);
assert.deepEqual(rows, saved.rows);
console.log(JSON.stringify({ 核验: '通过', 原始记录SHA256: sha256, 调用记录数: rows.length, 结果: rows.map(({ answer, ...row }) => row) }, null, 2));
