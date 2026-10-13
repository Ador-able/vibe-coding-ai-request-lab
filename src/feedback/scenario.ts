import materials from './materials.json';
import type { ReferenceRecord, SavedRule } from './contract.ts';

export const CHARACTERS = materials.characters;
export const RECORDS: ReferenceRecord[] = materials.records;
export const SUGGESTED_RULE = materials.rule;

export function buildRequestBody(model: string, record: ReferenceRecord, rule: SavedRule | null): string {
  // 所有笔记收到相同人物目录；规则范围由模型判断，不在代码里预填答案。
  const input = `人物目录：\n${JSON.stringify(CHARACTERS)}\n\n笔记：\n${JSON.stringify(record)}`
    + (rule ? `\n\n经人确认的指代规则：\n${rule.text}` : '');
  return JSON.stringify({ model, messages: [{ role: 'system', content: materials.system }, { role: 'user', content: input }],
    stream: false, temperature: 0, max_tokens: 2048, response_format: { type: 'json_object' } });
}
