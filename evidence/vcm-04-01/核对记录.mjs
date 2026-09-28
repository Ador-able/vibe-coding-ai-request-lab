import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// 只核对已保存的原始记录，不发起模型请求。
const names = ['浏览器实测-六次请求.json'];
const files = Object.fromEntries(names.map((name) => [name, createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex')]));
const raw = readFileSync(new URL(names[0], import.meta.url), 'utf8');
const record = JSON.parse(raw);
assert.equal(record.model, 'qwen3.7-flash-2026-07-15');
assert.equal(record.attempts.length, 6);
assert(!/Bearer\s|sk-[A-Za-z0-9]{12}|[A-Z]:[\\/]/.test(raw));
function checkPrivateKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!/^(authorization|api[_-]?key|api[_-]?base[_-]?url|headers)$/i.test(key));
    checkPrivateKeys(child);
  }
}
checkPrivateKeys(record);
const expectedCounts = [2, 2, 2, 1, 0, 0];
const expectedModes = ['prompt', 'object', 'strict', 'strict', 'strict', 'strict'];
const bodies = [];
const rows = [];
for (const [index, attempt] of record.attempts.entries()) {
  const { run } = attempt; const request = run.request; const body = JSON.parse(request.requestBody);
  checkPrivateKeys(body);
  assert.equal(attempt.transportError, null); assert.equal(run.error, undefined);
  assert.equal(attempt.mode, expectedModes[index]); assert.equal(run.mode, attempt.mode); assert.equal(run.material, attempt.material);
  assert.equal(body.model, record.model); assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system'); assert.equal(body.messages[1].role, 'user');
  assert.equal(body.messages[1].content, attempt.material);
  assert.equal(body.stream, false); assert.equal(body.enable_thinking, false); assert.equal(body.temperature, 0); assert.equal(body.max_tokens, 1024);
  assert.equal(request.httpStatus, 200); assert.equal(request.finishReason, 'stop'); assert.equal(request.responseModel, record.model);
  assert.equal(request.responseMessage.content, run.rawAnswer);
  const data = JSON.parse(run.rawAnswer); assert.deepEqual(run.inspection.data, data); assert.equal(data.items.length, expectedCounts[index]);
  assert(run.inspection.checks.slice(0, 3).every((check) => check.status === 'pass'));
  for (const [i, item] of data.items.entries()) {
    assert(item.evidence.length > 0); const position = attempt.material.indexOf(item.evidence); assert(position >= 0);
    assert.deepEqual(run.inspection.evidence[i], { index: i, found: true, start: position });
  }
  if (index < 3) {
    assert.deepEqual(data.items.map((item) => item.owner), ['陈岚', '周宇']);
    assert.deepEqual(data.items.map((item) => item.dueText), ['周三下班前', '周五上午']);
  }
  if (index === 3) { assert.equal(data.items[0].owner, null); assert.equal(data.items[0].dueText, null); }
  bodies.push(body);
  rows.push({ label: attempt.label, mode: attempt.mode, items: data.items.length, input: request.usage.prompt_tokens, output: request.usage.completion_tokens, finishReason: request.finishReason });
}
assert(!('response_format' in bodies[0]));
assert.deepEqual(bodies[1].response_format, { type: 'json_object' });
assert.equal(bodies[2].response_format.type, 'json_schema'); assert.equal(bodies[2].response_format.json_schema.strict, true);
for (const body of bodies.slice(1, 3)) { delete body.response_format; assert.deepEqual(body, bodies[0]); }
const report = { executionCommit: 'f659ab30306cefb8927b0034412bcc60c4ea74e8', files, modelCalls: 6, rows,
  firstThreeDifferOnlyInResponseFormat: true, rawAnswersMatchResponses: true, literalEvidenceLocated: true,
  noCredentialFieldsOrValuesFound: true, scope: '一次受控教学观察，不证明某模式必然失败或结果永远正确；人工错负责人反例不属于这六次调用。' };
writeFileSync(new URL('记录核对.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
