import { SOURCES } from '../novel-materials.ts';
import type { ReferenceRecord, SavedRule } from './contract.ts';
export const CHARACTERS = ['韩立', '韩铸', '韩父', '韩母', '韩立的三叔'];
const lines = SOURCES[0].text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
export const RECORDS: ReferenceRecord[] = ['二愣子睁大着双眼', '是二哥韩铸', '这位贵客，是跟他血缘很近'].map((phrase, index) => ({
  id: ['A', 'B', 'C'][index], speaker: '原文叙述者', text: lines.find(line => line.includes(phrase))!,
}));
export const SUGGESTED_RULE = '第一章原文明确：二愣子姓韩名立。“二愣子”是韩立的绰号，不表示排行第二。人物名已明确时以原文为准，不把韩铸或三叔归为韩立。';
export function buildRequestBody(model: string, record: ReferenceRecord, rule: SavedRule | null): string {
  const input = `人物目录：\n${JSON.stringify(CHARACTERS)}\n\n第一章原句：\n${JSON.stringify(record)}`
    + (rule ? `\n\n读者核对原文后保存的规则：\n${rule.text}` : '');
  return JSON.stringify({ model, messages: [{ role: 'system', content: '判断所附原句的主要人物。只依据当前输入，不用记忆中的小说补全。只返回JSON对象，包含“人物”和“依据”；人物为目录内称呼或null，依据简述原句或规则支持。信息不足时不猜测。' }, { role: 'user', content: input }],
    stream: false, temperature: 0, max_tokens: 2048, response_format: { type: 'json_object' } });
}
