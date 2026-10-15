import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MATERIAL } from '../src/output-material.ts';
import { inspectResponse } from '../src/structured/inspect.ts';
import { COUNTEREXAMPLE, COUNTEREXAMPLE_CHECK } from '../src/structured/counterexample.ts';

// 固定教师输入，只执行本地接收检查，不调用模型。
const evidence = '你侄子我路上自会照顾一二的';
const item = { task: '路上照顾韩立', owner: '王护法', dueText: null, evidence };
const complete = { items: [item] };
const conditions = [
  ['T1', '结构合格的一项，期限未知', 'stop', { content: JSON.stringify(complete) }],
  ['T2', '省略负责人和期限键', 'stop', { content: JSON.stringify({ items: [{ task: item.task, evidence }] }) }],
  ['T3', '正常结束的空数组', 'stop', { content: '{"items":[]}' }],
  ['T4', '正常结束但正文为空', 'stop', { content: '' }],
  ['T5', '正文闭合但长度截断', 'length', { content: '{"items":[]}' }],
  ['T6', '只有JSON前缀且长度截断', 'length', { content: '{"items":[' }],
  ['T7', '拒绝标记与合法JSON并存', 'stop', { content: JSON.stringify(complete), refusal: '教师构造的拒绝标记' }],
  ['T8', 'JSON外包Markdown围栏', 'stop', { content: '\`\`\`json\n' + JSON.stringify(complete) + '\n\`\`\`' }],
  ['T9', '负责人使用数字', 'stop', { content: JSON.stringify({ items: [{ ...item, owner: 7 }] }) }],
];
const output = {
  origin: 'teacher-constructed-input', cloudModelRequests: 0, sourceId: 'C02',
  material: MATERIAL, materialDigest: createHash('sha256').update(MATERIAL).digest('hex'),
  note: 'T1仅说明输入结构合格，不预先认定语义正确。T3是否漏提须对照片尾状态，检查器不作结论。',
  cases: conditions.map(([id, purpose, finishReason, responseMessage]) => ({
    id, purpose, origin: 'teacher-constructed-input', finishReason, responseMessage,
    inspection: inspectResponse(responseMessage, finishReason, MATERIAL),
  })),
  counterexample: { ...COUNTEREXAMPLE, origin: 'teacher-constructed-input', inspection: COUNTEREXAMPLE_CHECK },
};
mkdirSync('materials', { recursive: true });
writeFileSync('materials/122-教师边界检查.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ cases: output.cases.length, cloudModelRequests: 0,
  firstStops: output.cases.map(c => ({ id: c.id, checks: c.inspection.checks.map(k => k.status) })) }));
