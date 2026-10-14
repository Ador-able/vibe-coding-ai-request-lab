import type { Answer, Assessment } from './contract.ts';

export function assessAnswer(raw: string, finishReason: string | null | undefined, expected: Answer): Assessment {
  const failed = (issue: string): Assessment => ({ parsed: null, valid: false, issue, statusCorrect: false, rankCorrect: false, ageCorrect: false, sourcesCorrect: false, factsComplete: false, allCorrect: false });
  if (finishReason !== 'stop') return failed(`输出未完整结束：${finishReason ?? '未返回结束标记'}`);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return failed('返回文字不是有效 JSON 对象。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failed('返回值不是 JSON 对象。');
  const item = value as Record<string, unknown>;
  const keys = ['status', 'family_rank', 'age', 'source_ids'];
  if (Object.keys(item).length !== keys.length || !keys.every((key) => Object.hasOwn(item, key))
      || !['resolved', 'insufficient'].includes(item.status as string)
      || !(item.family_rank === null || Number.isInteger(item.family_rank))
      || !(item.age === null || Number.isInteger(item.age))
      || !Array.isArray(item.source_ids) || !item.source_ids.every((id) => typeof id === 'string')) {
    return failed('字段缺失、多余或类型不符；需要 status、family_rank、age、source_ids。');
  }
  const parsed = item as Answer;
  const statusCorrect = parsed.status === expected.status;
  const rankCorrect = parsed.family_rank === expected.family_rank;
  const ageCorrect = parsed.age === expected.age;
  // 引用集合必须完整且没有额外或重复记录，顺序不影响判定。
  const sourcesCorrect = parsed.source_ids.length === expected.source_ids.length
    && new Set(parsed.source_ids).size === parsed.source_ids.length
    && expected.source_ids.every((id) => parsed.source_ids.includes(id));
  const factsComplete = statusCorrect && rankCorrect && ageCorrect;
  return { parsed, valid: true, statusCorrect, rankCorrect, ageCorrect, sourcesCorrect, factsComplete, allCorrect: factsComplete && sourcesCorrect };
}
